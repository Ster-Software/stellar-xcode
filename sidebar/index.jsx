// The Xcode extension's sidebar: Bouwen and Archives for the project's Xcode project (when it has one), and the iOS
// Simulator. Sections under each other that share the height, like Stellar's own tabs.
import { useExtension, useT } from 'stellar';
import { Button, Section, Sections } from 'stellar/ui';
import { useXcodeSections } from './Xcode.jsx';
import { SimulatorSettings } from './Simulator.jsx';

export { ArchiveDetails } from './Xcode.jsx';

/** The sidebar fills Stellar's sidebar edge to edge: no padding, the sections share its height. */
const FILL = 'html, body, #root { height: 100%; overflow: hidden; } #root { padding: 0; }';

export default function XcodeSidebar() {
  const t = useT();
  const extension = useExtension();
  const xcode = useXcodeSections();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{FILL}</style>
      <Sections id="xcode">
        {(xcode || []).map(({ id, ...section }) => <Section key={id} id={id} {...section} />)}
        <Section id="simulator" title={t('simulator')} weight={1}
          actions={<Button size="sm" variant="ghost" icon="Smartphone" onClick={() => extension.call('openPanel')}>{t('openPanel')}</Button>}>
          <div style={{ padding: '4px 12px 12px' }}><SimulatorSettings /></div>
        </Section>
      </Sections>
    </div>
  );
}
