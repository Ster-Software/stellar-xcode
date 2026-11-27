// The Xcode extension's icon in the activity bar: Xcode's hammer, with a dot while an iOS simulator is on (pulsing
// while it starts or stops); the state comes from main.mjs.
import { Icon } from 'stellar/ui';

export default function XcodeIcon({ state, active, hover }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', color: active || hover ? 'var(--foreground)' : 'var(--muted-foreground)' }}>
      <style>{'@keyframes xc-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }'}</style>
      <Icon name="Xcode" size={21} />
      {(state?.booted || state?.busy) && (
        <span style={{
          position: 'absolute', right: -2, bottom: -1, width: 7, height: 7, borderRadius: '50%',
          background: state.busy ? 'var(--warning)' : 'var(--success)', animation: state.busy ? 'xc-pulse 1s ease-in-out infinite' : 'none',
        }} />
      )}
    </span>
  );
}
