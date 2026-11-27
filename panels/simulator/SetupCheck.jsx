// The check for what the simulator needs, shown instead of the phone until everything is there.
import { useState } from 'react';
import { useT } from 'stellar';
import { Badge, Button } from 'stellar/ui';
import { call } from '../../shared/api.js';

function Step({ number, title, done, waiting, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <Badge tone={done ? 'ok' : 'default'}>{done ? '✓' : number}</Badge>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <strong style={{ color: done || waiting ? 'var(--muted-foreground)' : 'var(--foreground)' }}>{title}</strong>
        {!done && !waiting && children}
      </div>
    </div>
  );
}

export function SetupCheck({ online, status, bridgeError }) {
  const t = useT();
  const [error, setError] = useState(null);
  const checks = status?.checks ?? {};
  const setup = status?.setup;
  const install = async () => {
    setError(null);
    try { await call('/setup', {}); } catch (e) { setError(e.message); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Step number={1} title={t('sim.setup.bridge')} done={online}>
        <span style={{ color: bridgeError ? 'var(--destructive)' : 'var(--muted-foreground)' }}>
          {bridgeError || t('sim.setup.bridgeText')}
        </span>
      </Step>
      <Step number={2} title={t('sim.setup.platform')} done={online && checks.platform} waiting={!online}>
        <span style={{ color: 'var(--destructive)' }}>{t('sim.setup.platformText')}</span>
      </Step>
      <Step number={3} title={t('sim.setup.xcode')} done={online && checks.xcode} waiting={!online}>
        <span style={{ color: 'var(--muted-foreground)' }}>
          {t('sim.setup.xcodeText')} <code>sudo xcode-select -s /Applications/Xcode.app</code>
        </span>
      </Step>
      <Step number={4} title={t('sim.setup.idb')} done={online && checks.companion && checks.grpc} waiting={!online || !checks.xcode || !checks.platform}>
        <span style={{ color: 'var(--muted-foreground)' }}>
          {t('sim.setup.idbText')}
        </span>
        {setup?.running
          ? <span>{t('sim.setup.busy', { step: setup.step })}</span>
          : <div><Button variant="default" icon="Download" onClick={install}>{t('sim.setup.install')}</Button></div>}
        {(error || setup?.error) && <span style={{ color: 'var(--destructive)' }}>{error || setup.error}</span>}
      </Step>
    </div>
  );
}
