import { useCallback, useEffect, useMemo, useState } from 'react';
import { listModels } from '@/lib/llm/client';
import { chromeKV } from '@/lib/storage/kv';
import { ProfileStore } from '@/lib/storage/profiles';
import { SettingsStore } from '@/lib/storage/settings';
import { ModelCatalog } from '@/lib/storage/models';
import { SitePermissionStore } from '@/lib/storage/sites';
import type { ContextMode, Profile, Theme } from '@/lib/types';
import { supportsVisionFor, visionChoices } from '@/lib/ui/models';
import { newProfile, parseKeywords, validateProfile } from '@/lib/ui/profileForm';
import { useTheme } from '@/lib/ui/useTheme';

export function App() {
  useTheme();
  return (
    <main className="options">
      <h1>Settings</h1>
      <p className="muted">Errand</p>
      <ProfilesSection />
      <SitesSection />
      <GeneralSection />
    </main>
  );
}

function ProfilesSection() {
  const store = useMemo(() => new ProfileStore(chromeKV()), []);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const refresh = useCallback(async () => setProfiles(await store.list()), [store]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section>
      <h2>Providers</h2>
      <ul className="rows">
        {profiles.map((p) => (
          <li key={p.id}>
            <span>
              <strong>{p.name}</strong>
              <span className="muted">{p.model || 'no model'}</span>
              <span className="tag">{p.contextMode}</span>
              {supportsVisionFor(p, p.model) && <span className="tag">vision</span>}
              {p.reasoningEffort && <span className="tag">{p.reasoningEffort} reasoning</span>}
            </span>
            <span className="row-actions">
              <button className="btn" onClick={() => setEditing(p)}>Edit</button>
              <button
                className="btn ghost danger"
                onClick={async () => {
                  await store.remove(p.id);
                  await refresh();
                }}
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={() => setEditing(newProfile())}>Add provider</button>
      {editing && (
        <ProfileForm
          key={editing.id}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={async (p) => {
            await store.save(p);
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function ProfileForm({ initial, onSave, onCancel }: { initial: Profile; onSave: (p: Profile) => void; onCancel: () => void }) {
  const [p, setP] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [cached, setCached] = useState<string[] | undefined>();
  useEffect(() => {
    void new ModelCatalog(chromeKV()).all().then((all) => setCached(all[initial.id]?.models));
  }, [initial.id]);
  const choices = visionChoices(p, models, cached);
  const perModel = (p.visionModels?.length ?? 0) > 0;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((prev) => ({ ...prev, [k]: v }));

  async function test() {
    setStatus('Testing…');
    try {
      const ids = await listModels(p);
      setModels(ids);
      // Warm the side panel's model menu with the same list.
      await new ModelCatalog(chromeKV(), async () => ids).refresh(p, { force: true });
      setStatus(`Connected. ${ids.length} model(s) available${ids.length ? ' — pick one in the Model field' : ''}.`);
    } catch (e) {
      setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function save() {
    const errs = validateProfile(p);
    setErrors(errs);
    if (!errs.length) onSave({ ...p, name: p.name.trim(), baseUrl: p.baseUrl.trim(), model: p.model.trim() });
  }

  return (
    <div className="form">
      <label>Name<input value={p.name} onChange={(e) => set('name', e.target.value)} /></label>
      <label>
        Base URL
        <input value={p.baseUrl} placeholder="http://macbook.your-tailnet.ts.net:8000/v1" onChange={(e) => set('baseUrl', e.target.value)} />
      </label>
      <label>API key<input type="password" value={p.apiKey} autoComplete="off" onChange={(e) => set('apiKey', e.target.value)} /></label>
      <label>
        Model
        <input list="model-ids" value={p.model} onChange={(e) => set('model', e.target.value)} />
        <datalist id="model-ids">{models.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <label className="check">
        <input type="checkbox" checked={p.supportsVision} disabled={perModel} onChange={(e) => set('supportsVision', e.target.checked)} /> Supports images (vision)
        {perModel && <span className="muted"> — set per model below</span>}
      </label>
      {choices.length > 0 && (
        <fieldset className="vision-models">
          <legend>Vision-capable models <span className="muted">(leave all unticked to use the checkbox above for every model)</span></legend>
          {choices.map((m) => (
            <label key={m} className="check">
              <input
                type="checkbox"
                checked={(p.visionModels ?? []).includes(m)}
                onChange={(e) =>
                  set('visionModels', e.target.checked ? [...(p.visionModels ?? []), m] : (p.visionModels ?? []).filter((x) => x !== m))
                }
              />
              {m}
            </label>
          ))}
        </fieldset>
      )}
      <label>
        Context mode
        <select value={p.contextMode} onChange={(e) => set('contextMode', e.target.value as ContextMode)}>
          <option value="compact">Compact — small local models</option>
          <option value="standard">Standard</option>
          <option value="full">Full — large-context models</option>
        </select>
      </label>
      <label>Context window (tokens)<input type="number" value={p.contextWindow} onChange={(e) => set('contextWindow', Number(e.target.value))} /></label>
      <label>
        Reasoning effort
        <select value={p.reasoningEffort ?? ''} onChange={(e) => set('reasoningEffort', (e.target.value || undefined) as Profile['reasoningEffort'])}>
          <option value="">Model default</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low — fastest</option>
        </select>
      </label>
      <label>
        Screenshots kept (Full mode)
        <input type="number" min={1} max={10} value={p.maxScreenshots} onChange={(e) => set('maxScreenshots', Number(e.target.value))} />
      </label>
      {errors.length > 0 && <ul className="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="actions">
        <button className="btn" onClick={() => void test()}>Test connection</button>
        <span className="status">{status}</span>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}

function SitesSection() {
  const store = useMemo(() => new SitePermissionStore(chromeKV()), []);
  const [origins, setOrigins] = useState<string[]>([]);
  const refresh = useCallback(async () => setOrigins(await store.list()), [store]);
  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  return (
    <section>
      <h2>Always-allowed sites</h2>
      {origins.length === 0 ? (
        <p className="muted">None yet. Choose "Always allow" in the side panel to add one.</p>
      ) : (
        <ul className="rows">
          {origins.map((o) => (
            <li key={o}>
              <span>{o}</span>
              <button className="btn ghost danger" onClick={() => void store.revoke(o).then(refresh)}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GeneralSection() {
  const store = useMemo(() => new SettingsStore(chromeKV()), []);
  const [stepLimit, setStepLimit] = useState(30);
  const [keywords, setKeywords] = useState('');
  const [debugTiming, setDebugTiming] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    void store.get().then((s) => {
      setStepLimit(s.stepLimit);
      setKeywords(s.riskyKeywords.join(', '));
      setDebugTiming(s.debugTiming);
      setTheme(s.theme);
    });
  }, [store]);

  async function save() {
    const limit = Math.max(1, Math.min(200, Math.round(stepLimit)));
    await store.update({ stepLimit: limit, riskyKeywords: parseKeywords(keywords), debugTiming });
    setStepLimit(limit);
    setSaved('Saved.');
  }

  return (
    <section>
      <h2>General</h2>
      <div className="field">
        <span>Theme</span>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={theme === t}
              className={theme === t ? 'on' : ''}
              onClick={() => {
                setTheme(t);
                void store.update({ theme: t });
              }}
            >
              {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </div>
      <label>Step limit per task<input type="number" min={1} max={200} value={stepLimit} onChange={(e) => setStepLimit(Number(e.target.value))} /></label>
      <label>
        Words that make a click need approval (comma or newline separated)
        <textarea rows={4} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={debugTiming} onChange={(e) => setDebugTiming(e.target.checked)} /> Log step timings to the service worker console
      </label>
      <div className="actions">
        <button className="btn primary" onClick={() => void save()}>Save</button>
        <span className="status">{saved}</span>
      </div>
    </section>
  );
}
