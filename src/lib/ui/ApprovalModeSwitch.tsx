import { APPROVAL_MODE_HINT, APPROVAL_MODE_LABEL } from '@/lib/policy/approval';
import type { ApprovalMode } from '@/lib/types';

const MODES: ApprovalMode[] = ['ask', 'auto', 'hands-off'];

export function ApprovalModeSwitch({
  value,
  disabled,
  className = 'mode',
  onChange,
}: {
  value: ApprovalMode;
  disabled?: boolean;
  className?: string;
  onChange(mode: ApprovalMode): void;
}) {
  return (
    <div className={className} role="radiogroup" aria-label="Approval mode">
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          className={value === mode ? 'on' : ''}
          title={APPROVAL_MODE_HINT[mode]}
          disabled={disabled}
          onClick={() => onChange(mode)}
        >
          {APPROVAL_MODE_LABEL[mode]}
        </button>
      ))}
    </div>
  );
}
