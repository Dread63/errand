import { useState } from 'react';
import type { PendingGate } from '@/lib/ui/panelState';

export function GateCard({ gate, onAnswer }: { gate: PendingGate; onAnswer: (value: string | boolean) => void }) {
  const [answer, setAnswer] = useState('');
  const r = gate.request;
  switch (r.kind) {
    case 'site':
      return (
        <div className="gate" role="dialog" aria-label="Site permission">
          <p>
            Allow the agent to read and act on <strong>{r.origin}</strong>?
          </p>
          <div className="gate-actions">
            <button className="primary" onClick={() => onAnswer('once')}>Allow once</button>
            <button onClick={() => onAnswer('always')}>Always allow</button>
            <button className="danger" onClick={() => onAnswer('deny')}>Deny</button>
          </div>
        </div>
      );
    case 'risky':
      return (
        <div className="gate gate-risky" role="dialog" aria-label="Approve action">
          <p className="gate-title">Approve this action?</p>
          <p className="gate-desc">{r.description}</p>
          <ul>{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          {r.reason && <p className="reasoning">Model's reason: {r.reason}</p>}
          <div className="gate-actions">
            <button className="primary" onClick={() => onAnswer(true)}>Approve</button>
            <button className="danger" onClick={() => onAnswer(false)}>Reject</button>
          </div>
        </div>
      );
    case 'ask':
      return (
        <div className="gate" role="dialog" aria-label="Question from the agent">
          <p>{r.question}</p>
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && answer.trim() && onAnswer(answer.trim())} autoFocus />
          <div className="gate-actions">
            <button className="primary" disabled={!answer.trim()} onClick={() => onAnswer(answer.trim())}>Send answer</button>
          </div>
        </div>
      );
    case 'retry':
      return (
        <div className="gate gate-error" role="dialog" aria-label="Task paused">
          <p>{r.message}</p>
          <div className="gate-actions">
            <button className="primary" onClick={() => onAnswer(true)}>Retry</button>
            <button onClick={() => onAnswer(false)}>Stop</button>
          </div>
        </div>
      );
  }
}
