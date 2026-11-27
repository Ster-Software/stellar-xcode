// An Xcode action (build, run, test, clean) for an agent or a chat: what isn't given comes from the sidebar's choices
// for the project, like its buttons; it runs as the same terminal task the sidebar starts, and with `wait` the result
// and the last lines come back. Shared by mcp.mjs (xcode_run) and main.mjs (/xcode-build in a chat).
import { storage, terminal } from 'stellar/extension';
import * as xcode from './xcode.mjs';
import { trackAction } from './status.mjs';

export const AGENT_ACTIONS = ['build', 'run', 'test', 'clean'];
// Waiting for an action stays under the 5 minutes an agent waits for a tool.
const WAIT_MS = 4 * 60 * 1000;
const TAIL_LINES = 60;

/** The exit code of terminal `id` when it ends; undefined when it still runs after WAIT_MS. */
function exitOf(id) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { sub.dispose(); resolve(undefined); }, WAIT_MS);
    const sub = terminal.onExit(id, ({ exitCode }) => { clearTimeout(timer); sub.dispose(); resolve(exitCode); });
  });
}

/** The project of the chat's window; an error without one. */
export function rootOf(context) {
  const root = context?.project?.root;
  if (!root) throw new Error('Het venster van deze chat heeft geen project open.');
  return root;
}

// As the sidebar picks (sidebar/Xcode.jsx): the chosen one when it is still there, else a sensible first.
const destKey = (d) => d.id || `generic:${d.platform}`;
const pick = (list, chosen, preferred) => (list?.includes(chosen) ? chosen : list?.includes(preferred) ? preferred : list?.[0] || null);
function defaultDestination(list) {
  const concrete = list.filter((d) => !d.generic);
  return concrete.find((d) => d.platform === 'iOS Simulator' && /^iPhone/.test(d.name)) || concrete[0] || list[0] || null;
}

/** Runs `args.action` in the project of `context`; a sentence (with the result and last lines when it waited). */
export async function runAction(args, context) {
  const root = rootOf(context);
  const chosen = (await storage.project.get('choices')) || {};
  const projects = xcode.projectInfo(root).projects.map((p) => p.path);
  const project = pick(projects, args.project ?? chosen.project);
  if (!project) throw new Error('Geen Xcode-project gevonden in dit project.');
  if (args.project && project !== args.project) throw new Error(`Onbekend Xcode-project: ${args.project} (zie xcode_projects).`);
  const { schemes, configurations } = await xcode.listSchemes(root, project);
  const scheme = pick(schemes, args.scheme ?? chosen.scheme);
  if (!scheme || (args.scheme && scheme !== args.scheme)) throw new Error(`Onbekend scheme: ${args.scheme || '(geen)'}.`);
  const configuration = pick(configurations, args.configuration ?? chosen.configuration, 'Debug');
  const list = await xcode.listDestinations(root, project, scheme);
  const wanted = args.destination ?? chosen.destination;
  const destination = list.find((d) => destKey(d) === wanted) || (args.destination ? null : defaultDestination(list));
  if (!destination) throw new Error(`Onbekende bestemming: ${args.destination}. Kies uit: ${list.map(destKey).join(', ')}`);
  const task = { action: args.action, project, scheme, configuration, destination, team: chosen.team || null };
  const { terminal: id } = await terminal.runTask('xcode', task, { title: `${args.action} ${scheme}`, icon: 'Hammer', background: true });
  trackAction(id, `${args.action} ${scheme}`);
  const what = `${args.action} ${scheme} (${configuration}, ${destination.name || destination.platform})`;
  if (!args.wait || args.action === 'run') return `${what} loopt in terminal ${id}.`;
  const exitCode = await exitOf(id);
  const shown = await terminal.read(id);
  const tail = (shown?.text || '').split('\n').slice(-TAIL_LINES).join('\n');
  if (exitCode === undefined) return `${what} loopt nog na ${WAIT_MS / 60000} minuten (terminal ${id}).\n\n${tail}`;
  return `${what} is ${exitCode === 0 ? 'gelukt' : `mislukt (exitcode ${exitCode})`} (terminal ${id}).\n\n${tail}`;
}
