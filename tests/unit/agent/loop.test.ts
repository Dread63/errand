import { describe, expect, it } from 'vitest';
import { runAgent } from '@/lib/agent/loop';
import { DetachedError, LlmError, TaskEndedError, ToolError } from '@/lib/errors';
import { SitePolicy } from '@/lib/policy/sites';
import { memoryKV } from '@/lib/storage/kv';
import { SettingsStore } from '@/lib/storage/settings';
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
    s.deps.settings.troubleLimit = 3;
    const turns = await runAgent(task, s.deps);
    expect(s.gate.log.filter((l) => l.startsWith('retry:'))).toHaveLength(1);
    expect(s.gate.log[s.gate.log.length - 1]).toContain('not valid JSON');
    expect(last(turns)).toEqual({ kind: 'assistant', text: expect.stringContaining('Stopped after 3 consecutive problems: Error: Tool arguments') });
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

  it('ask prompts for a download, a form submit, a payment label, and a password', async () => {
    const s = setup([
      toolCall('click', { id: 8 }),
      toolCall('click', { id: 2 }),
      toolCall('click', { id: 4 }),
      toolCall('type', { id: 3, text: 'pw' }),
      toolCall('done', { summary: 'x' }),
    ]);
    s.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    s.driver.elements[2] = el(2, { isSubmit: true, name: 'Go' });
    s.driver.elements[4] = el(4, { name: 'Place order' });
    s.driver.elements[3] = el(3, { tag: 'input', role: 'textbox', type: 'password', name: 'Password' });
    s.gate.riskyAnswers = [true, true, true, true];
    await runAgent(task, s.deps);
    expect(s.gate.riskySeen.map((r) => r.grantable)).toEqual([true, false, false, false]);
    expect(s.driver.performed.map((c) => c.args.id)).toEqual([8, 2, 4, 3]);
  });

  it('auto skips a download but still asks for the site, a form submit, a payment, and a password', async () => {
    const s = setup([
      toolCall('click', { id: 8 }),
      toolCall('click', { id: 2 }),
      toolCall('click', { id: 4 }),
      toolCall('type', { id: 3, text: 'pw' }),
      toolCall('done', { summary: 'x' }),
    ]);
    s.deps.approvalMode = 'auto';
    s.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    s.driver.elements[2] = el(2, { isSubmit: true, name: 'Go' });
    s.driver.elements[4] = el(4, { name: 'Pay now' });
    s.driver.elements[3] = el(3, { tag: 'input', role: 'textbox', type: 'password', name: 'Password' });
    s.gate.siteAnswers = ['once'];
    s.gate.riskyAnswers = [true, true, true];
    await runAgent(task, s.deps);
    expect(s.gate.log.filter((l) => l.startsWith('site:'))).toEqual(['site:https://shop.test']);
    expect(s.gate.log.filter((l) => l.startsWith('risky:'))).toEqual([
      'risky:Click the "Go" button',
      'risky:Click the "Pay now" button',
      'risky:Type "••••••" into the "Password" text box',
    ]);
    expect(s.gate.riskySeen.every((r) => !r.grantable)).toBe(true);
    expect(s.driver.performed.map((c) => c.args.id)).toEqual([8, 2, 4, 3]);
    expect(await s.siteStore.list()).toEqual([]);
  });

  it.each([
    {
      path: 'clicking a submit button',
      action: () => toolCall('click', { id: 2 }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.elements[2] = el(2, { isSubmit: true, name: 'Go' });
      },
      prompt: 'risky:Click the "Go" button',
    },
    {
      path: 'pressing Enter in an address field',
      action: () => toolCall('key', { combo: 'Enter' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.focused = el(9, { tag: 'input', role: 'textbox', name: 'Address', inForm: true });
      },
      prompt: 'risky:Press Enter',
    },
    {
      path: 'typing into an address field and submitting',
      action: () => toolCall('type', { id: 2, text: '1 Main', submit: true }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.elements[2] = el(2, { tag: 'input', role: 'textbox', name: 'Address', inForm: true });
      },
      prompt: 'risky:Type "1 Main" into the "Address" text box and press Enter',
    },
    {
      path: 'typing a newline into an address field',
      action: () => toolCall('type', { id: 2, text: '1 Main\n' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.elements[2] = el(2, { tag: 'input', role: 'textbox', name: 'Address', inForm: true });
      },
      prompt: 'risky:Type "1 Main⏎" into the "Address" text box',
    },
    {
      path: 'pressing Enter on a Place order button',
      action: () => toolCall('key', { combo: 'Enter' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.focused = el(2, { isSubmit: true, name: 'Place order' });
      },
      prompt: 'risky:Press Enter',
    },
    {
      path: 'pressing Space on a submit button',
      action: () => toolCall('key', { combo: 'Space' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.focused = el(2, { isSubmit: true, name: 'Go' });
      },
      prompt: 'risky:Press Space',
    },
  ])('$path always asks in Auto and Hands-off', async ({ action, arm, prompt }) => {
    for (const mode of ['auto', 'hands-off'] as const) {
      const s = setup([action(), toolCall('done', { summary: 'x' })]);
      s.deps.approvalMode = mode;
      arm(s);
      s.gate.siteAnswers = ['once'];
      s.gate.riskyAnswers = [false];
      await runAgent(task, s.deps);
      expect(s.gate.riskySeen[0]?.grantable).toBe(false);
      expect(s.gate.log).toContain(prompt);
      expect(s.driver.performed).toEqual([]);
    }
  });

  it.each([
    {
      path: 'a click on submit',
      action: () => toolCall('click', { id: 2 }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.elements[2] = el(2, { isSubmit: true, name: 'Go' });
      },
      prompt: 'risky:Click the "Go" button',
    },
    {
      path: 'Enter in an address field',
      action: () => toolCall('key', { combo: 'Enter' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.focused = el(9, { tag: 'input', role: 'textbox', name: 'Address', inForm: true });
      },
      prompt: 'risky:Press Enter',
    },
    {
      path: 'typing and submitting an address',
      action: () => toolCall('type', { id: 2, text: '1 Main', submit: true }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.elements[2] = el(2, { tag: 'input', role: 'textbox', name: 'Address', inForm: true });
      },
      prompt: 'risky:Type "1 Main" into the "Address" text box and press Enter',
    },
    {
      path: 'a newline in an address field',
      action: () => toolCall('type', { id: 2, text: '1 Main\n' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.elements[2] = el(2, { tag: 'input', role: 'textbox', name: 'Address', inForm: true });
      },
      prompt: 'risky:Type "1 Main⏎" into the "Address" text box',
    },
    {
      path: 'Enter on Place order',
      action: () => toolCall('key', { combo: 'Enter' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.focused = el(2, { isSubmit: true, name: 'Place order' });
      },
      prompt: 'risky:Press Enter',
    },
    {
      path: 'Space on a submit button',
      action: () => toolCall('key', { combo: 'Space' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.focused = el(2, { isSubmit: true, name: 'Go' });
      },
      prompt: 'risky:Press Space',
    },
  ])('$path still asks after Allow for the rest of this task', async ({ action, arm, prompt }) => {
    const s = setup([toolCall('click', { id: 8 }), action(), toolCall('done', { summary: 'x' })]);
    s.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    arm(s);
    s.gate.siteAnswers = ['once'];
    s.gate.riskyAnswers = ['task', false];
    await runAgent(task, s.deps);
    expect(s.gate.riskySeen.map((r) => r.grantable)).toEqual([true, false]);
    expect(s.gate.log).toContain(prompt);
    expect(s.driver.performed.map((c) => c.name)).toEqual(['click']);
  });

  const typeBypasses = [
    {
      path: 'typing on a Pay now button',
      action: () => toolCall('type', { id: 2, text: 'x' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.elements[2] = el(2, { name: 'Pay now', inForm: false, isSubmit: false });
      },
      prompt: 'risky:Type "x" into the "Pay now" button',
    },
    {
      path: 'typing on a form submit button',
      action: () => toolCall('type', { id: 2, text: 'x' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.elements[2] = el(2, { name: 'Continue', inForm: true, isSubmit: true });
      },
      prompt: 'risky:Type "x" into the "Continue" button',
    },
    {
      path: 'submitting a Pay now button outside a form',
      action: () => toolCall('type', { text: 'x', submit: true }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.focused = el(2, { name: 'Pay now', inForm: false, isSubmit: false });
      },
      prompt: 'risky:Type "x" into the "Pay now" button and press Enter',
    },
    {
      path: 'a newline on a Place order button outside a form',
      action: () => toolCall('type', { text: 'a\nb' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.focused = el(2, { name: 'Place order', inForm: false, isSubmit: false });
      },
      prompt: 'risky:Type "a⏎b" into the "Place order" button',
    },
    {
      path: 'typing into a frame the page cannot read',
      action: () => toolCall('type', { text: '4242' }),
      arm: (s: ReturnType<typeof setup>) => {
        s.driver.focused = el(2, { tag: 'iframe', role: 'generic', name: 'Secure payment input frame' });
      },
      prompt: 'risky:Type "4242" into "Secure payment input frame"',
    },
  ];

  it.each(typeBypasses)('$path asks in Ask, Auto, and Hands-off', async ({ action, arm, prompt }) => {
    for (const mode of ['ask', 'auto', 'hands-off'] as const) {
      const s = setup([action(), toolCall('done', { summary: 'x' })]);
      s.deps.approvalMode = mode;
      arm(s);
      s.gate.siteAnswers = ['once'];
      s.gate.riskyAnswers = [false];
      await runAgent(task, s.deps);
      expect(s.gate.riskySeen[0]?.grantable).toBe(false);
      expect(s.gate.log).toContain(prompt);
      expect(s.driver.performed).toEqual([]);
    }
  });

  it.each(typeBypasses)('$path still asks after a task grant', async ({ action, arm, prompt }) => {
    const s = setup([toolCall('click', { id: 8 }), action(), toolCall('done', { summary: 'x' })]);
    s.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    arm(s);
    s.gate.siteAnswers = ['once'];
    s.gate.riskyAnswers = ['task', false];
    await runAgent(task, s.deps);
    expect(s.gate.riskySeen.map((r) => r.grantable)).toEqual([true, false]);
    expect(s.gate.log).toContain(prompt);
    expect(s.driver.performed.map((c) => c.name)).toEqual(['click']);
  });

  it('hands-off opens a new site for this task only and still asks for a card field', async () => {
    const s = setup([
      toolCall('type', { id: 3, text: '4111' }),
      toolCall('done', { summary: 'Opened the page.\nThe price is $5.' }),
    ]);
    s.deps.approvalMode = 'hands-off';
    s.driver.elements[3] = el(3, { tag: 'input', role: 'textbox', autocomplete: 'cc-number', name: 'Card' });
    s.gate.riskyAnswers = [true];
    const turns = await runAgent(task, s.deps);
    expect(s.gate.log.filter((l) => l.startsWith('site:'))).toEqual([]);
    expect(s.gate.riskySeen[0].grantable).toBe(false);
    expect(await s.siteStore.isAllowed('https://shop.test')).toBe(false);
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'Opened the page.' });

    const again = setup([toolCall('done', { summary: 'Asked.' })]);
    again.deps.sites = new SitePolicy(s.siteStore);
    again.gate.siteAnswers = ['deny'];
    await runAgent(task, again.deps);
    expect(again.gate.log).toContain('site:https://shop.test');
  });

  it('an invalid approval mode asks before a routine download', async () => {
    const s = setup([toolCall('click', { id: 8 }), toolCall('done', { summary: 'x' })]);
    s.deps.approvalMode = 'bypass' as 'ask';
    s.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    s.gate.riskyAnswers = [true];
    await runAgent(task, s.deps);
    expect(s.gate.log).toContain('risky:Click the "Get" link');
  });

  it('a saved auto-approve site list does not skip prompts and is deleted', async () => {
    const kv = memoryKV();
    await kv.set('bypassOrigins', ['https://shop.test']);
    const settings = await new SettingsStore(kv).get();
    const s = setup([toolCall('click', { id: 8 }), toolCall('done', { summary: 'x' })]);
    s.deps.settings = { ...settings, troubleLimit: 10 };
    s.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    s.gate.riskyAnswers = [true];
    await runAgent(task, s.deps);
    expect(s.gate.log).toContain('risky:Click the "Get" link');
    expect(await kv.get('bypassOrigins')).toBeUndefined();
  });

  it('allow for the rest of this task skips later downloads, not a form submit, and the next task asks again', async () => {
    const s = setup([
      toolCall('click', { id: 8 }),
      toolCall('click', { id: 5 }),
      toolCall('click', { id: 2 }),
      toolCall('type', { id: 3, text: '4111' }),
      toolCall('type', { id: 6, text: 'secret' }),
      toolCall('done', { summary: 'done' }),
    ]);
    s.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    s.driver.elements[5] = el(5, { tag: 'a', role: 'link', name: 'Save', download: true });
    s.driver.elements[2] = el(2, { isSubmit: true, name: 'Go' });
    s.driver.elements[3] = el(3, { tag: 'input', role: 'textbox', autocomplete: 'cc-number', name: 'Card' });
    s.driver.elements[6] = el(6, { tag: 'input', role: 'textbox', type: 'password', name: 'Password' });
    s.gate.siteAnswers = ['once'];
    s.gate.riskyAnswers = ['task', true, true, true];
    await runAgent(task, s.deps);
    expect(s.gate.log.filter((l) => l.startsWith('risky:'))).toEqual([
      'risky:Click the "Get" link',
      'risky:Click the "Go" button',
      'risky:Type "••••••" into the "Card" text box',
      'risky:Type "••••••" into the "Password" text box',
    ]);
    expect(s.gate.riskySeen.map((r) => r.grantable)).toEqual([true, false, false, false]);
    expect(s.driver.performed.map((c) => c.args.id)).toEqual([8, 5, 2, 3, 6]);
    expect(await s.siteStore.list()).toEqual([]);

    const next = setup([toolCall('click', { id: 8 }), toolCall('done', { summary: 'x' })]);
    next.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    next.gate.siteAnswers = ['once'];
    next.gate.riskyAnswers = [false];
    await runAgent(task, next.deps);
    expect(next.gate.log).toContain('risky:Click the "Get" link');
    expect(next.driver.performed).toEqual([]);
  });

  it('a task answer on a password does not grant the submit or a later download', async () => {
    const s = setup([
      toolCall('type', { id: 3, text: 'secret' }),
      toolCall('click', { id: 8 }),
      toolCall('click', { id: 2 }),
      toolCall('done', { summary: 'x' }),
    ]);
    s.driver.elements[3] = el(3, { tag: 'input', role: 'textbox', type: 'password', name: 'Password' });
    s.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    s.driver.elements[2] = el(2, { isSubmit: true, name: 'Continue' });
    s.gate.siteAnswers = ['once'];
    s.gate.riskyAnswers = ['task', true, true];
    await runAgent(task, s.deps);
    expect(s.gate.riskySeen.map((r) => r.grantable)).toEqual([false, true, false]);
    expect(s.driver.performed.map((c) => c.args.id)).toEqual([3, 8, 2]);
  });

  it('cancelling the task drops the task grant', async () => {
    const s = setup([toolCall('click', { id: 8 }), toolCall('click', { id: 5 })]);
    s.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    s.driver.elements[5] = el(5, { tag: 'a', role: 'link', name: 'Save', download: true });
    s.gate.siteAnswers = ['once'];
    s.gate.riskyAnswers = ['task'];
    const perform = s.driver.perform.bind(s.driver);
    s.driver.perform = async (call) => {
      const result = await perform(call);
      s.ctrl.abort();
      return result;
    };
    expect(last(await runAgent(task, s.deps))).toEqual({ kind: 'assistant', text: 'Stopped.' });
    expect(s.driver.performed).toHaveLength(1);

    const next = setup([toolCall('click', { id: 8 }), toolCall('done', { summary: 'x' })]);
    next.driver.elements[8] = el(8, { tag: 'a', role: 'link', name: 'Get', download: true });
    next.gate.siteAnswers = ['once'];
    next.gate.riskyAnswers = [false];
    await runAgent(task, next.deps);
    expect(next.gate.log).toContain('risky:Click the "Get" link');
    expect(next.driver.performed).toEqual([]);
  });

  it('hands-off ends every task with one sentence, including a rejection or an error', async () => {
    const handsOff = setup([toolCall('done', { summary: ' \n ' })]);
    handsOff.deps.approvalMode = 'hands-off';
    expect(last(await runAgent(task, handsOff.deps))).toEqual({ kind: 'assistant', text: 'Task complete.' });

    const rejected = setup([
      toolCall('click', { id: 2 }),
      textReply('I could not submit.\nTry another way.'),
    ]);
    rejected.deps.approvalMode = 'hands-off';
    rejected.driver.elements[2] = el(2, { isSubmit: true, name: 'Go' });
    rejected.gate.riskyAnswers = [false];
    expect(last(await runAgent(task, rejected.deps))).toEqual({ kind: 'assistant', text: 'I could not submit.' });

    const failed = setup([]);
    failed.deps.approvalMode = 'hands-off';
    failed.gate.siteAnswers = ['once'];
    failed.driver.observeErrors = [new Error('The tab closed.\nReload it.')];
    expect(last(await runAgent(task, failed.deps))).toEqual({ kind: 'assistant', text: 'Error: The tab closed.' });

    const ask = setup([toolCall('done', { summary: 'Opened the page.\nThe price is $5.' })]);
    ask.gate.siteAnswers = ['once'];
    expect(last(await runAgent(task, ask.deps))).toEqual({ kind: 'assistant', text: 'Opened the page.\nThe price is $5.' });
  });

  it('asks before a key types or pastes into a password or card, in every mode', async () => {
    for (const mode of ['ask', 'auto', 'hands-off'] as const) {
      for (const combo of ['s', 'Meta+v']) {
        const s = setup([toolCall('key', { combo }), toolCall('done', { summary: 'x' })]);
        s.deps.approvalMode = mode;
        s.driver.focused = el(3, { tag: 'input', role: 'textbox', type: combo === 's' ? 'password' : 'text', autocomplete: combo === 's' ? undefined : 'cc-number', name: combo === 's' ? 'Password' : 'Card' });
        s.gate.siteAnswers = ['once'];
        s.gate.riskyAnswers = [false];
        await runAgent(task, s.deps);
        expect(s.gate.riskySeen[0]?.grantable).toBe(false);
        expect(s.gate.log).toContain(`risky:Press ${combo}`);
        expect(s.driver.performed).toEqual([]);
      }
    }
  });

  it('types into an ordinary Order number field without a prompt', async () => {
    const s = setup([toolCall('type', { id: 2, text: '100' }), toolCall('done', { summary: 'x' })]);
    s.driver.elements[2] = el(2, { tag: 'input', role: 'textbox', type: 'text', name: 'Order number', inForm: true, isSubmit: false });
    s.gate.siteAnswers = ['once'];
    await runAgent(task, s.deps);
    expect(s.gate.log.filter((l) => l.startsWith('risky:'))).toEqual([]);
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

  it('allows 60 successful steps without a total-step cap', async () => {
    const s = setup([
      ...Array.from({ length: 60 }, (_, i) => toolCall('navigate', { url: `https://shop.test/page/${i}` })),
      toolCall('done', { summary: 'Long task complete' }),
    ]);
    const turns = await runAgent(task, s.deps);
    expect(s.driver.performed).toHaveLength(60);
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'Long task complete' });
    expect(s.gate.log.filter((l) => l.startsWith('retry:'))).toEqual([]);
    expect(JSON.stringify(s.llm.requests[0].messages)).not.toContain('You have at most');
  });

  it('asks after N consecutive tool errors and stops with the last error', async () => {
    const s = setup(Array.from({ length: 4 }, () => toolCall('click', { id: 99 })));
    s.deps.settings.troubleLimit = 3;
    const turns = await runAgent(task, s.deps);
    expect(s.llm.requests).toHaveLength(3);
    expect(s.gate.log).toContain('retry:The agent has hit 3 problems in a row: Error: Element [99] no longer exists on the page. Keep going?');
    expect(last(turns)).toMatchObject({ text: expect.stringContaining('Stopped after 3 consecutive problems') });
  });

  it('Retry resets the trouble count and allows another full budget', async () => {
    const s = setup(Array.from({ length: 6 }, () => toolCall('click', { id: 99 })));
    s.deps.settings.troubleLimit = 3;
    s.gate.retryAnswers = [true, false];
    await runAgent(task, s.deps);
    expect(s.llm.requests).toHaveLength(6);
    expect(s.gate.log.filter((l) => l.startsWith('retry:'))).toHaveLength(2);
  });

  it('success resets consecutive errors, including mixed malformed and tool errors', async () => {
    const s = setup([
      toolCall('click', {}), toolCall('click', { id: 99 }),
      toolCall('click', { id: 1 }),
      toolCall('click', { id: 99 }), toolCall('click', {}),
      toolCall('done', { summary: 'Recovered' }),
    ]);
    s.deps.settings.troubleLimit = 3;
    expect(last(await runAgent(task, s.deps))).toMatchObject({ text: 'Recovered' });
    expect(s.gate.log.filter((l) => l.startsWith('retry:'))).toEqual([]);
  });

  it('identical calls on an unchanged page consume trouble, ignoring argument order and call ids', async () => {
    const s = setup([
      toolCall('type', { id: 1, text: 'hello' }),
      toolCall('type', { text: 'hello', id: 1 }),
      toolCall('type', { id: 1, text: 'hello' }),
    ]);
    s.deps.settings.troubleLimit = 2;
    const turns = await runAgent(task, s.deps);
    expect(s.driver.performed).toHaveLength(3);
    expect(last(turns)).toMatchObject({ text: expect.stringContaining('No progress: repeated type') });
    expect(s.gate.log.filter((l) => l.startsWith('retry:'))).toHaveLength(1);
  });

  it('a different successful action resets repetition trouble', async () => {
    const s = setup([
      toolCall('hover', { id: 1 }), toolCall('hover', { id: 1 }),
      toolCall('click', { id: 1 }), toolCall('hover', { id: 1 }),
      toolCall('done', { summary: 'Recovered' }),
    ]);
    s.deps.settings.troubleLimit = 2;
    expect(last(await runAgent(task, s.deps))).toMatchObject({ text: 'Recovered' });
    expect(s.gate.log.filter((l) => l.startsWith('retry:'))).toEqual([]);
  });

  it('uses the configured threshold when malformed calls exhaust trouble sooner', async () => {
    const s = setup([toolCall('click', {}), toolCall('click', {}), toolCall('done', { summary: 'Recovered' })]);
    s.deps.settings.troubleLimit = 2;
    s.gate.retryAnswers = [true];
    expect(last(await runAgent(task, s.deps))).toMatchObject({ text: 'Recovered' });
    expect(s.gate.log.filter((l) => l.startsWith('retry:'))).toEqual([
      'retry:The agent has hit 2 problems in a row: Error: click requires "id". Keep going?',
    ]);
  });

  it('changed observations make repeating a call progress', async () => {
    const s = setup([
      ...Array.from({ length: 10 }, () => toolCall('click', { id: 1 })),
      toolCall('done', { summary: 'Progress' }),
    ]);
    const perform = s.driver.perform.bind(s.driver);
    s.driver.perform = async (c) => {
      const result = await perform(c);
      s.driver.elements[1].name = `Page ${s.driver.performed.length}`;
      return result;
    };
    s.deps.settings.troubleLimit = 2;
    expect(last(await runAgent(task, s.deps))).toMatchObject({ text: 'Progress' });
    expect(s.driver.performed).toHaveLength(10);
    expect(s.gate.log.filter((l) => l.startsWith('retry:'))).toEqual([]);
  });

  it('a repeated call stops the rest of its batch and tells the model', async () => {
    const s = setup([{
      content: '',
      toolCalls: [
        ...toolCall('hover', { id: 1 }).toolCalls,
        ...toolCall('select', { id: 1, value: 'a' }).toolCalls,
        ...toolCall('hover', { id: 1 }).toolCalls,
        ...toolCall('select', { id: 1, value: 'a' }).toolCalls,
      ],
    }, toolCall('done', { summary: 'ok' })]);
    const turns = await runAgent(task, s.deps);
    expect(s.driver.performed).toHaveLength(3);
    expect(steps(turns)[2].result).toContain('No progress');
  });

  it('catches alternating loops across replies', async () => {
    const s = setup([
      toolCall('hover', { id: 1 }), toolCall('select', { id: 1, value: 'a' }),
      toolCall('hover', { id: 1 }), toolCall('select', { id: 1, value: 'a' }),
    ]);
    s.deps.settings.troubleLimit = 2;
    await runAgent(task, s.deps);
    expect(s.gate.log.filter((l) => l.startsWith('retry:'))).toHaveLength(1);
  });

  it('stops when aborted', async () => {
    const s = setup([toolCall('wait', { ms: 1 }), toolCall('wait', { ms: 1 })]);
    s.deps.hooks.onTurns = () => s.ctrl.abort();
    const turns = await runAgent(task, s.deps);
    expect(last(turns)).toEqual({ kind: 'assistant', text: 'Stopped.' });
  });
});
