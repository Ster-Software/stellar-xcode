// For testing this extension's own modules outside Stellar: makes `import … from 'stellar/extension'` resolve to a
// small fake (i18n.t gives the key back). Import this first, then the module under test with a dynamic import(): a
// static import would be resolved before this runs.
import { registerHooks } from 'node:module';

const NAMES = ['commands', 'settings', 'storage', 'notify', 'terminal', 'panels', 'project', 'activityBar', 'windows',
  'projects', 'i18n', 'sidebar', 'dialogs', 'tools', 'z', 'languages', 'files', 'statusBar', 'chats', 'agents', 'browser',
  'automations', 'scm'];

globalThis.__stellarTestApi = {
  ...Object.fromEntries(NAMES.map((name) => [name, {}])),
  notify: () => {},
  i18n: { t: (key) => key, language: 'nl' },
};

const source = `const api = globalThis.__stellarTestApi;\nexport const { ${NAMES.join(', ')} } = api;\n`;
const url = `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve: (specifier, context, nextResolve) => (specifier === 'stellar/extension'
    ? { url, shortCircuit: true }
    : nextResolve(specifier, context)),
});
