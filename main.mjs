// The Xcode extension (was Stellar's own Xcode tab, together with the iOS Simulator extension): build, run, test,
// clean and archive an Xcode project in a terminal tab (a task that knows what it is, also when reopened), the
// archives with an upload to App Store Connect, and a real iOS Simulator, headless, in a panel. Its sidebar has both;
// its icon shows a dot while a simulator is on.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { activityBar, chats, commands, i18n, notify, panels, sidebar, storage, terminal } from 'stellar/extension';
import * as xcode from './lib/xcode.mjs';
import { trackAction } from './lib/status.mjs';
import { runAction } from './lib/actions.mjs';
import { startBridge, stopBridge } from './lib/sim/server.mjs';

const STATUS_POLL_MS = 3000;

/** The project of the window a handler runs for; an error without one. */
function rootOf(context) {
  const root = context?.project?.root;
  if (!root) throw new Error('Open eerst een project.');
  return root;
}

// The simulator's bridge starts the first time the panel or the sidebar needs it.
let bridge = null;
let poll = null;
async function ensureBridge(log) {
  if (!bridge) {
    bridge = startBridge().then(({ url, own }) => {
      log(own ? `Simulator-bridge gestart op ${url}` : `Er draaide al een simulator-bridge op ${url}; die wordt gebruikt.`);
      followSimulator(url);
      return url;
    }, (error) => {
      bridge = null;
      throw error;
    });
  }
  return bridge;
}

/** The icon follows the simulator: a dot while one is on, pulsing while it starts or stops. */
function followSimulator(url) {
  let last = null;
  clearInterval(poll);
  poll = setInterval(async () => {
    const status = await fetch(`${url}/status`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json()).then((j) => j.data, () => null);
    const state = { booted: Boolean(status?.device?.booted), busy: status?.busy || null };
    if (JSON.stringify(state) === JSON.stringify(last)) return;
    last = state;
    activityBar.update({ state }, { window: 'all' }).catch(() => {});
  }, STATUS_POLL_MS);
}

export async function activate(context) {
  // Xcode and the iOS Simulator are macOS only; elsewhere the icon stays away.
  if (process.platform !== 'darwin') await activityBar.update({ visible: false }, { window: 'all' });
  const bridgeUrl = () => ensureBridge(context.log);
  const openSimulator = () => panels.open('simulator');

  context.subscriptions.push(
    // A tab of an Xcode action: the command is made here each time it starts (projects, schemes and teams checked).
    terminal.task('xcode', (args, { project }) => xcode.taskCommand(project?.root || '', args)),

    sidebar.handle({
      // Xcode
      info: (args, ctx) => xcode.projectInfo(rootOf(ctx)),
      formatter: () => xcode.hasFormatter(),
      teams: () => xcode.listTeams(),
      schemes: ({ project }, ctx) => xcode.listSchemes(rootOf(ctx), project),
      destinations: ({ project, scheme }, ctx) => xcode.listDestinations(rootOf(ctx), project, scheme),
      archives: ({ scheme }) => xcode.listArchives(scheme),
      // The choices of the sidebar (project, scheme, configuration, destination, team), per project.
      choices: async () => (await storage.project.get('choices')) || {},
      choose: async (patch) => {
        const next = { ...((await storage.project.get('choices')) || {}), ...patch };
        await storage.project.set('choices', next);
        return next;
      },
      run: async ({ task }) => {
        const title = task.action === 'upload' ? `upload ${task.scheme}` : `${task.action} ${task.scheme}`;
        const started = await terminal.runTask('xcode', task, { title, icon: 'Hammer' });
        // While it runs, and how it ended, in the status bar.
        trackAction(started?.terminal, title);
        return started;
      },
      // Opens the project in Xcode, or an archive in the Organizer.
      open: ({ project, path: file }, ctx) => new Promise((resolve, reject) => {
        const target = project ? path.join(rootOf(ctx), project) : file;
        if (!target || !(project || /\.xcarchive$/.test(target))) { reject(new Error('Niets om te openen.')); return; }
        execFile('/usr/bin/open', [target], (error) => (error ? reject(error) : resolve(true)));
      }),
      installFormatter: () => terminal.run('brew install xcbeautify', { title: 'xcbeautify installeren' }),
      failed: ({ title, message }) => notify.error({ title, body: String(message || '').slice(-400) }),
      // Simulator
      bridge: async () => ({ url: await bridgeUrl() }),
      openPanel: openSimulator,
    }),
    panels.handle('simulator', { bridge: async () => ({ url: await bridgeUrl() }) }),
    // /xcode-build in a chat: build with the sidebar's choices (a scheme after it overrules), and the result with the
    // last lines into that chat, so its agent can act on the errors.
    commands.register('xcode.buildInChat', async ({ chat, text = '' } = {}, ctx) => {
      const result = await runAction({ action: 'build', ...(text.trim() ? { scheme: text.trim() } : {}), wait: true }, ctx);
      if (chat) await chats.send(chat, `${i18n.t('buildResult')}\n\n${result}`);
      return result;
    }),
    commands.register('xcode.simulator', openSimulator),
    commands.register('xcode.simulatorShutdown', async () => {
      const url = await bridgeUrl();
      const json = await fetch(`${url}/shutdown`, { method: 'POST' }).then((r) => r.json()).catch(() => ({ ok: false }));
      if (!json.ok) throw new Error(json.error || 'Afsluiten mislukt.');
      await notify({ title: 'iOS Simulator', body: 'De simulator is uit.' });
    }),
  );
}

export async function deactivate() {
  clearInterval(poll);
  await stopBridge();
}
