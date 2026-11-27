// The Simulator section of the Xcode sidebar (was the iOS Simulator extension's sidebar, before that the panel's
// settings menu): which iOS version and model, light or dark, and the buttons for the running simulator. It talks to
// the same bridge as the panel (shared/api.js); the extension says where it runs.
import { useEffect, useState } from 'react';
import { useExtension, useT } from 'stellar';
import { Button, SegmentedControl, Select } from 'stellar/ui';
import { call, isLive, setBridge, useBridge } from '../shared/api.js';

const label = { display: 'block', margin: '14px 0 6px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted-foreground)' };
const row = { display: 'flex', flexWrap: 'wrap', gap: 6 };

/** What the simulator is doing, in a word. */
function stateText(status, t) {
  if (status.busy) return t(status.busy === 'opstarten' ? 'sim.starting' : 'sim.stopping');
  return t(status.device?.booted ? 'sim.on' : 'sim.off');
}

export function SimulatorSettings() {
  const t = useT();
  const extension = useExtension();
  const [error, setError] = useState(null);
  useEffect(() => { extension.call('bridge').then(({ url }) => setBridge(url), (e) => setError(e.message)); }, [extension]);
  const { online, status, refresh } = useBridge();

  const act = async (path, body = {}) => {
    setError(null);
    try {
      await call(path, body);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  if (online === undefined && !error) return null;
  if (!online || !status) return <p style={{ color: 'var(--muted-foreground)' }}>{error || t('sim.noBridge')}</p>;
  const { runtimes = [], selection, device } = status;
  const runtime = runtimes.find((r) => r.id === selection?.runtime) ?? runtimes[0];
  const live = isLive(online, status);
  const chooseRuntime = (id) => {
    const next = runtimes.find((r) => r.id === id);
    const sameModel = next.models.find((m) => m.id === selection?.model);
    act('/select', { runtime: next.id, model: (sameModel ?? next.models[0]).id });
  };
  const models = ['iPhone', 'iPad'].map((family) => ({
    heading: family, options: (runtime?.models || []).filter((m) => m.family === family).map((m) => ({ value: m.id, label: m.name })),
  })).filter((group) => group.options.length);

  return (
    <div>
      <p style={{ color: 'var(--muted-foreground)', margin: 0 }}>{stateText(status, t)}{device?.name ? ` · ${device.name}` : ''}</p>

      {!status.ready && <p style={{ color: 'var(--muted-foreground)' }}>{t('sim.notReady')}</p>}

      {runtime && (
        <>
          <span style={label}>{t('sim.iosVersion')}</span>
          <Select label={t('sim.iosVersion')} block value={runtime.id} options={runtimes.map((r) => ({ value: r.id, label: r.name }))} onChange={chooseRuntime}
            disabled={Boolean(status.busy)} />
          <span style={label}>{t('sim.device')}</span>
          <Select label={t('sim.device')} block value={selection?.model} options={models} onChange={(model) => act('/select', { runtime: runtime.id, model })}
            disabled={Boolean(status.busy)} />
        </>
      )}
      {!runtime && <p style={{ color: 'var(--muted-foreground)' }}>{t('sim.noRuntimes')}</p>}

      {live && (
        <>
          <span style={label}>{t('sim.appearance')}</span>
          <SegmentedControl label={t('sim.appearance')} value={status.appearance || 'light'}
            options={[{ value: 'light', label: t('sim.light') }, { value: 'dark', label: t('sim.dark') }]} onChange={(appearance) => act('/appearance', { appearance })} />
        </>
      )}

      {/* Paneel openen is in the section's header. */}
      <div style={{ ...row, marginTop: 14 }}>
        {live && <Button variant="outline" icon="Home" onClick={() => act('/button', { button: 'HOME' })}>Home</Button>}
        {live && <Button variant="outline" icon="Lock" onClick={() => act('/button', { button: 'LOCK' })}>{t('sim.lock')}</Button>}
        {status.ready && !device?.booted && !status.busy && <Button variant="default" icon="Play" onClick={() => act('/boot')}>{t('sim.boot')}</Button>}
        {live && <Button variant="outline" icon="Power" onClick={() => act('/shutdown')}>{t('sim.shutdown')}</Button>}
      </div>
      {error && <p style={{ color: 'var(--destructive)', marginTop: 10 }}>{error}</p>}
    </div>
  );
}
