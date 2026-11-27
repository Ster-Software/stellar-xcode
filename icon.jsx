// The Xcode extension's icon in the activity bar: Xcode's hammer, with a dot while an iOS simulator is on (pulsing
// while it starts or stops); the state comes from main.mjs.
import { Icon } from 'stellar/ui';

export default function XcodeIcon({ state, active, hover }) {
  return (
    <span className={`relative inline-flex ${active || hover ? 'text-foreground' : 'text-muted-foreground'}`}>
      <Icon name="Xcode" size={21} />
      {(state?.booted || state?.busy) && (
        <span className={`absolute -right-0.5 -bottom-px size-[7px] rounded-full ${state.busy ? 'animate-pulse bg-warning' : 'bg-success'}`} />
      )}
    </span>
  );
}
