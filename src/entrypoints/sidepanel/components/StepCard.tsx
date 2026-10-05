import { useState } from 'react';
import type { StepTurn } from '@/lib/types';

export function StepCard({ step }: { step: StepTurn }) {
  const [open, setOpen] = useState(false);
  const failed = step.result.startsWith('Error') || step.result.startsWith('The user rejected');
  const shot = step.observation?.screenshot;
  return (
    <div className={`step${failed ? ' step-failed' : ''}`}>
      <button className="step-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {shot && <img className="thumb" src={shot} alt="" />}
        <span className="step-label">{step.label}</span>
        {step.risky && <span className="badge">approval</span>}
      </button>
      {open && (
        <div className="step-body">
          {step.reasoning && <p className="reasoning">{step.reasoning}</p>}
          <pre className="result">{step.result}</pre>
          {shot && <img className="shot" src={shot} alt="Page before this step" />}
        </div>
      )}
    </div>
  );
}
