import { useState } from 'react';
import { IconGlobe, IconWarning } from '@/lib/ui/icons';
import type { PendingGate } from '@/lib/ui/panelState';

export function GateCard({ gate, onAnswer }: { gate: PendingGate; onAnswer: (value: string | boolean) => void }) {
  const [answer, setAnswer] = useState('');
  const r = gate.request;
  switch (r.kind) {
    case 'site':
      return (
        <div className="gate" role="dialog" aria-label="Site permission">
          <p className="gate-title"><IconGlobe size={15} /> Allow access to this site?</p>
          <p className="gate-desc">The agent wants to read and act on <strong>{r.origin}</strong>.</p>
          <div className="gate-actions">
            <button className="btn primary" onClick={() => onAnswer('once')}>Allow once</button>
            <button className="btn" onClick={() => onAnswer('always')}>Always allow</button>
            <button className="btn ghost danger" onClick={() => onAnswer('deny')}>Deny</button>
          </div>
        </div>
      );
    case 'risky':
      return (
        <div className="gate gate-risky" role="dialog" aria-label="Approve action">
          <p className="gate-title"><IconWarning size={15} /> Approve this action?</p>
          <p className="gate-desc">{r.description}</p>
          <ul className="gate-reasons">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          {r.reason && <p className="gate-why">Model's reason: {r.reason}</p>}
          <div className="gate-actions">
            <button className="btn primary" onClick={() => onAnswer(true)}>Approve</button>
            <button className="btn" onClick={() => onAnswer(false)}>Reject</button>
          </div>
        </div>
      );
    case 'ask':
      return (
        <div className="gate" role="dialog" aria-label="Question from the agent">
          <p className="gate-desc">{r.question}</p>
          <input
            className="gate-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && answer.trim() && onAnswer(answer.trim())}
            autoFocus
          />
          <div className="gate-actions">
            <button className="btn primary" disabled={!answer.trim()} onClick={() => onAnswer(answer.trim())}>Send answer</button>
          </div>
        </div>
      );
    case 'retry':
      return (
        <div className="gate gate-error" role="dialog" aria-label="Task paused">
          <p className="gate-desc">{r.message}</p>
          <div className="gate-actions">
            <button className="btn primary" onClick={() => onAnswer(true)}>Retry</button>
            <button className="btn" onClick={() => onAnswer(false)}>Stop</button>
          </div>
        </div>
      );
  }
}
