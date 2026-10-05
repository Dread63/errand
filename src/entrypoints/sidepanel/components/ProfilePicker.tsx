import type { Profile } from '@/lib/types';

interface Props {
  profiles: Profile[];
  activeId: string | null;
  disabled: boolean;
  onChange(id: string): void;
}

export function ProfilePicker({ profiles, activeId, disabled, onChange }: Props) {
  const known = profiles.some((p) => p.id === activeId);
  return (
    <select className="profile-picker" aria-label="Model profile" value={known ? activeId! : ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value="">Choose a model…</option>}
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} · {p.model}
        </option>
      ))}
    </select>
  );
}
