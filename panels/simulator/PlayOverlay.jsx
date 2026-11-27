// The round play button on the black screen: starts the chosen simulator (creating it if needed).
import { useT } from 'stellar';
import { Icon } from 'stellar/ui';

const SIZE = 64;
const BAR_WIDTH = 140;

const SPIN_CSS = '@keyframes sim-spin { to { transform: rotate(360deg); } }';

/** What you see while the simulator starts: a spinner, the phase and a progress bar. */
function Booting({ busy, boot }) {
  const t = useT();
  const label = busy === 'afsluiten' ? t('sim.shutdown') : t(`sim.phase.${boot?.phase || 'Starting'}`);
  const progress = busy === 'afsluiten' ? null : boot?.progress ?? 0.05;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <style>{SPIN_CSS}</style>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.15)',
        borderTopColor: 'rgba(255,255,255,0.85)', animation: 'sim-spin 0.9s linear infinite',
      }} />
      <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>{label}…</span>
      {progress !== null && (
        <div style={{ width: BAR_WIDTH, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
          <div style={{ width: `${progress * 100}%`, height: '100%', background: '#fff', borderRadius: 2, transition: 'width 0.6s ease' }} />
        </div>
      )}
    </div>
  );
}

export function PlayOverlay({ busy, boot, onPlay }) {
  const t = useT();
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {busy ? <Booting busy={busy} boot={boot} /> : (
        <button type="button" onClick={onPlay} title={t('sim.boot')}
          style={{
            pointerEvents: 'auto', width: SIZE, height: SIZE, borderRadius: '50%', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.14)', color: '#fff',
          }}>
          <Icon name="Play" size={26} />
        </button>
      )}
    </div>
  );
}

/** An error, fixed at the bottom of the screen until it is closed or replaced. */
export function ErrorBar({ message, onClose }) {
  const t = useT();
  if (!message) return null;
  return (
    <div role="alert" onClick={onClose} title={t('sim.close')}
      style={{
        pointerEvents: 'auto', position: 'absolute', left: 12, right: 12, bottom: 28, padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
        background: 'rgba(180, 35, 35, 0.92)', color: '#fff', fontSize: 12, lineHeight: 1.35, overflowWrap: 'anywhere',
      }}>
      {message}
    </div>
  );
}
