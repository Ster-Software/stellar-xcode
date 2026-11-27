// The Xcode extension's sidebar: Bouwen and Archives for the project's Xcode project (when it has one), and the iOS
// Simulator. Sections under each other that share the height, like Stellar's own tabs.
import { useExtension, useT } from 'stellar';
import { Button, Section, Sections } from 'stellar/ui';
import { useXcodeSections } from './Xcode.jsx';
import { SimulatorSettings } from './Simulator.jsx';

export { ArchiveDetails } from './Xcode.jsx';

export default function XcodeSidebar() {
  const t = useT();
  const extension = useExtension();
  const xcode = useXcodeSections();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Sections id="xcode">
        {(xcode || []).map(({ id, ...section }) => <Section key={id} id={id} {...section} />)}
        <Section id="simulator" title={t('simulator')} weight={1}
          actions={<Button size="sm" variant="ghost" icon="Smartphone" onClick={() => extension.call('openPanel')}>{t('openPanel')}</Button>}>
          <div className="pt-1"><SimulatorSettings /></div>
        </Section>
      </Sections>
    </div>
  );
}
