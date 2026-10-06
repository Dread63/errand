import { describe, expect, it } from 'vitest';
import { runAgent } from '@/lib/agent/loop';
import { DetachedError, LlmError, TaskEndedError, ToolError } from '@/lib/errors';
import type { StepTurn } from '@/lib/types';
import { el, last, setup, task, textReply, toolCall } from './fakes';

const steps = (turns: Awaited<ReturnType<typeof runAgent>>) => turns.filter((t): t is StepTurn => t.kind === 'step');

describe('runAgent', () => {

  it('records step timing and the thinking streamed for that step', async () => {
    const s = setup([{ ...toolCall('click', { id: 1 }), thinking: 'I should click the button.' }, toolCall('done', { summary: 'ok' })]);
    let t = 1000;
    s.deps.now = () => (t += 100);
    const turns = await runAgent(task, s.deps);
    const [click, done] = steps(turns);
    expect(click.thinking).toBe('I should click the button.');
    expect(click.thinkingMs).toBeGreaterThan(0);
    expect(click.startedAt).toBeLessThan(click.endedAt!);
    expect(done.thinking).toBeUndefined();
    expect(done.startedAt).toBeGreaterThanOrEqual(click.endedAt!);
  });

  it('truncates very long thinking', async () => {
    const s = setup([{ ...toolCall('done', { summary: 'ok' }), thinking: 'x'.repeat(5000) }]);
    const [done] = steps(await runAgent(task, s.deps));
    expect(done.thinking!.length).toBeLessThanOrEqual(4001);
    expect(done.thinking!.startsWith('…')).toBe(true);
  });
  it('performs a click then finishes with the done summary', async () => {
    const s = setup([toolCall('click', { id: 1 }, 'Clicking the button'), toolCall('done', { summary: 'All done' })]);
    const turns = await runAgent(task, s.deps);
    expect(s.driver.performed.map((c) => c.name)).toEqual(['click']);
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'All done' });
    const [click] = steps(turns);
    expect(click).toMatchObject({ label: 'Click the "Button 1" button', reasoning: 'Clicking the button', result: 'ok click', risky: false });
    expect(click.call.id).toBe(click.id);
    expect(click.observation?.detail).toContain('[1] button "Button 1"');
    expect(s.turnsSeen.length).toBeGreaterThan(1);
  });

  it('passes the session id on every model request', async () => {
    const s = setup([toolCall('wait', { ms: 1 }), toolCall('done', { summary: 'x' })]);
    s.deps.sessionId = 'conv-9';
    await runAgent(task, s.deps);
    expect(s.llm.requests.map((r) => r.sessionId)).toEqual(['conv-9', 'conv-9']);
  });

  it('Review Focus: a plain-text reply is the final answer', async () => {
    const s = setup([textReply('The price is $5.')]);
    const turns = await runAgent(task, s.deps);
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'The price is $5.' });
    expect(s.driver.performed).toEqual([]);
  });

  it('after acting, a plain-text reply gets one nudge to call a tool instead of ending the task', async () => {
    const s = setup([
      toolCall('click', { id: 1 }),
      textReply('Let me check the other page.'),
      toolCall('done', { summary: 'Shop B is cheaper.' }),
    ]);
    const turns = await runAgent(task, s.deps);
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'Shop B is cheaper.' });
    const tail = s.llm.requests[2].messages.slice(-2);
    expect(tail[0]).toEqual({ role: 'assistant', content: 'Let me check the other page.' });
    expect(tail[1]).toMatchObject({ role: 'user', content: expect.stringContaining('call done') });
    // The nudge is not kept in the conversation shown to the user.
    expect(turns.some((t) => t.kind === 'assistant' && t.text.includes('Let me check'))).toBe(false);
  });

  it('a second plain-text reply in a row is accepted as the answer, so it never spins', async () => {
    const s = setup([toolCall('click', { id: 1 }), textReply('Thinking.'), textReply('The price is $5.')]);
    const turns = await runAgent(task, s.deps);
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'The price is $5.' });
    expect(s.llm.requests).toHaveLength(3);
  });

  it('feeds validation errors back to the model, then recovers', async () => {
    const s = setup([toolCall('click', {}), toolCall('click', { id: 1 }), toolCall('done', { summary: 'ok' })]);
    const turns = await runAgent(task, s.deps);
    expect(steps(turns)[0].result).toBe('Error: click requires "id".');
    const second = JSON.stringify(s.llm.requests[1].messages);
    expect(second).toContain('click requires');
    expect(s.driver.performed).toHaveLength(1);
  });

  it('pauses after 3 malformed calls in a row and stops when the user declines', async () => {
    const bad = { content: '', toolCalls: [{ id: '', name: 'click', args: {}, error: 'Tool arguments were not valid JSON: {id' }] };
    const s = setup([bad, bad, bad]);
    const turns = await runAgent(task, s.deps);
    expect(s.gate.log.filter((l) => l.startsWith('retry:'))).toHaveLength(1);
    expect(s.gate.log[s.gate.log.length - 1]).toContain('not valid JSON');
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'Stopped after repeated invalid tool calls.' });
  });

  it('Review Focus: a stale element id becomes an error for the model and the loop continues', async () => {
    const s = setup([toolCall('click', { id: 99 }), toolCall('done', { summary: 'ok' })]);
    const turns = await runAgent(task, s.deps);
    expect(steps(turns)[0].result).toBe('Error: Element [99] no longer exists on the page.');
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'ok' });
  });

  it('asks for site permission once per origin and respects deny', async () => {
    const s = setup([toolCall('navigate', { url: 'https://other.test/' }), toolCall('done', { summary: 'x' })]);
    s.gate.siteAnswers = ['once', 'deny'];
    const turns = await runAgent(task, s.deps);
    expect(s.gate.log.filter((l) => l.startsWith('site:'))).toEqual(['site:https://shop.test', 'site:https://other.test']);
    expect(steps(turns)[0].result).toBe('Error: the user denied access to https://other.test.');
    expect(s.driver.performed).toEqual([]);
  });

  it('does not read a page the user denied', async () => {
    const s = setup([toolCall('done', { summary: 'x' })]);
    s.gate.siteAnswers = ['deny'];
    await runAgent(task, s.deps);
    expect(s.driver.observed).toBe(0);
    expect(JSON.stringify(s.llm.requests[0].messages)).toContain('has not allowed the agent on https://shop.test');
  });

  it('"always" is stored', async () => {
    const s = setup([toolCall('done', { summary: 'x' })]);
    s.gate.siteAnswers = ['always'];
    await runAgent(task, s.deps);
    expect(await s.siteStore.isAllowed('https://shop.test')).toBe(true);
  });

  it('rejected risky actions are not performed', async () => {
    const s = setup([toolCall('click', { id: 2 }), toolCall('done', { summary: 'x' })]);
    s.driver.elements[2] = el(2, { name: 'Place order' });
    s.gate.riskyAnswers = [false];
    const turns = await runAgent(task, s.deps);
    expect(s.driver.performed).toEqual([]);
    expect(steps(turns)[0]).toMatchObject({ risky: true, label: 'Click the "Place order" button' });
    expect(steps(turns)[0].result).toMatch(/rejected/);
    expect(s.driver.highlights[0]?.element?.id).toBe(2);
    expect(s.driver.highlights[1]).toBeNull();
  });

  it('a rejected risky action ends the task with a tool-less reply to the user', async () => {
    const s = setup([
      toolCall('click', { id: 2 }),
      textReply('I clicked Search, then tried to delete them. How would you like to proceed?'),
      toolCall('click', { id: 1 }),
    ]);
    s.driver.elements[2] = el(2, { name: 'Delete' });
    s.gate.riskyAnswers = [false];
    const turns = await runAgent(task, s.deps);
    expect(s.llm.requests).toHaveLength(2);
    expect(s.llm.requests[1].tools).toEqual([]);
    expect(JSON.stringify(s.llm.requests[1].messages)).toMatch(/rejected/);
    expect(s.driver.performed).toEqual([]);
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'I clicked Search, then tried to delete them. How would you like to proceed?' });
  });

  it('after a rejection, a done call or an empty reply still ends the task', async () => {
    const s = setup([toolCall('click', { id: 2 }), toolCall('done', { summary: 'Stopping here.' })]);
    s.driver.elements[2] = el(2, { name: 'Delete' });
    s.gate.riskyAnswers = [false];
    expect(last(await runAgent(task, s.deps))).toEqual({ kind: 'assistant', text: 'Stopping here.' });

    const s2 = setup([toolCall('click', { id: 2 }), textReply('')]);
    s2.driver.elements[2] = el(2, { name: 'Delete' });
    s2.gate.riskyAnswers = [false];
    const turns = await runAgent(task, s2.deps);
    expect(s2.llm.requests).toHaveLength(2);
    expect(last(turns)).toMatchObject({ kind: 'assistant', text: expect.stringMatching(/rejected/) });
  });

  it('approved risky actions are performed', async () => {
    const s = setup([toolCall('click', { id: 2 }), toolCall('done', { summary: 'x' })]);
    s.driver.elements[2] = el(2, { isSubmit: true });
    s.gate.riskyAnswers = [true];
    await runAgent(task, s.deps);
    expect(s.driver.performed.map((c) => c.args.id)).toEqual([2]);
  });

  it('masks typed passwords in the saved step', async () => {
    const s = setup([toolCall('type', { id: 3, text: 'hunter2' }), toolCall('done', { summary: 'x' })]);
    s.driver.elements[3] = el(3, { tag: 'input', role: 'textbox', type: 'password', name: 'Password' });
    s.gate.riskyAnswers = [true];
    const turns = await runAgent(task, s.deps);
    expect(s.driver.performed[0].args.text).toBe('hunter2');
    expect(steps(turns)[0].call.args.text).toBe('••••••');
  });

  it('answers ask_user through the gate', async () => {
    const s = setup([toolCall('ask_user', { question: 'Which size?' }), toolCall('done', { summary: 'x' })]);
    s.gate.askAnswers = ['Medium'];
    const turns = await runAgent(task, s.deps);
    expect(steps(turns)[0].result).toBe('User answered: Medium');
  });

  it('pauses on DetachedError, reattaches on Retry and repeats the action', async () => {
    const s = setup([toolCall('click', { id: 1 }), toolCall('done', { summary: 'x' })]);
    s.driver.performErrors = [new DetachedError('Lost the tab.')];
    s.gate.retryAnswers = [true];
    await runAgent(task, s.deps);
    expect(s.driver.reattached).toBe(1);
    expect(s.driver.performed).toHaveLength(1);
  });

  it('stops when the user declines Retry after a model error', async () => {
    const s = setup([new LlmError('HTTP 401: bad key', false, 401)]);
    const turns = await runAgent(task, s.deps);
    expect(s.gate.log).toContain('retry:Model request failed: HTTP 401: bad key');
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'Stopped: the model request failed (HTTP 401: bad key).' });
  });

  it('retries the model call when the user presses Retry', async () => {
    const s = setup([new LlmError('timeout', true), toolCall('done', { summary: 'recovered' })]);
    s.gate.retryAnswers = [true];
    expect(last(await runAgent(task, s.deps))).toEqual({ kind: 'assistant', text: 'recovered' });
  });

  it('Review Focus: ends cleanly when all agent tabs are closed', async () => {
    const s = setup([]);
    s.driver.observeErrors = [new TaskEndedError('All agent tabs were closed, so the task ended.')];
    expect(last(await runAgent(task, s.deps))).toEqual({ kind: 'assistant', text: 'All agent tabs were closed, so the task ended.' });
  });

  it('an unreadable page is reported to the model instead of ending the task', async () => {
    const s = setup([toolCall('done', { summary: 'moved on' })]);
    s.driver.observeErrors = [new ToolError('Could not reach the page (it may still be loading): gone')];
    const turns = await runAgent(task, s.deps);
    expect(JSON.stringify(s.llm.requests[0].messages)).toContain('could not be read');
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'moved on' });
  });

  it('stops at the step limit', async () => {
    const s = setup(Array.from({ length: 5 }, () => toolCall('wait', { ms: 1 })));
    s.deps.settings = { ...s.deps.settings, stepLimit: 3 };
    const turns = await runAgent(task, s.deps);
    expect(s.driver.performed).toHaveLength(3);
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'Stopped: reached the step limit of 3 steps.' });
  });

  it('stops when aborted', async () => {
    const s = setup([toolCall('wait', { ms: 1 }), toolCall('wait', { ms: 1 })]);
    s.deps.hooks.onTurns = () => s.ctrl.abort();
    const turns = await runAgent(task, s.deps);
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'Stopped.' });
  });
});
