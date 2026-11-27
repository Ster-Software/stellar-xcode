// Xcode for a project: find .xcworkspace/.xcodeproj, list schemes and destinations, and build the
// shell command for build/run/test/clean/archive in a terminal tab. Everything goes through xcodebuild.
// (Was Stellar's own electron/lib/xcodeService.mjs before the Xcode tab became this extension.)
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { i18n } from 'stellar/extension';
import { parse, build } from './plist.mjs';

/** One argument for the zsh the tasks run in, always quoted (as Stellar's npm tasks do). */
export const shellQuote = (arg) => `'${String(arg).replace(/'/g, "'\\''")}'`;
const t = (key, vars) => i18n.t(key, vars);

export const ACTIONS = ['build', 'run', 'test', 'clean', 'archive'];
const MAX_DEPTH = 3;
const MAX_DIRS = 2000;
const SKIP_DIRS = new Set(['node_modules', 'Pods', 'build', 'DerivedData', 'Carthage', 'vendor', '.build']);
const QUICK_TIMEOUT_MS = 60 * 1000;
// zsh is always there on macOS; a login shell finds Homebrew tools like xcbeautify.
const SHELL = '/bin/zsh';
const PLATFORM_RE = /^[A-Za-z ]+$/;
const ID_RE = /^[A-Za-z0-9._:-]+$/;
const TEAM_RE = /^[A-Z0-9]{10}$/;
const ARCHIVES_ROOT = path.join(os.homedir(), 'Library/Developer/Xcode/Archives');

async function readArchive(archivePath) {
  const xml = await new Promise((resolve, reject) => {
    execFile('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', path.join(archivePath, 'Info.plist')],
      { timeout: QUICK_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => err ? reject(err) : resolve(stdout));
  });
  const info = parse(xml);
  const app = info.ApplicationProperties || {};
  return {
    path: archivePath,
    name: info.Name || path.basename(archivePath, '.xcarchive'),
    scheme: info.SchemeName || info.Name,
    created: info.CreationDate ? new Date(info.CreationDate).toISOString() : null,
    version: app.CFBundleShortVersionString || '',
    build: app.CFBundleVersion || '',
    bundleId: app.CFBundleIdentifier || '',
    uploadable: Boolean(app.ApplicationPath && app.CFBundleIdentifier),
  };
}

/** Organizer archives for the selected scheme, newest first. Ignores incomplete archives. */
export async function listArchives(scheme, root = ARCHIVES_ROOT) {
  if (!scheme) return [];
  let days;
  try { days = await fsp.readdir(root, { withFileTypes: true }); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const archives = [];
  for (const day of days.filter((entry) => entry.isDirectory())) {
    const dir = path.join(root, day.name);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isDirectory() && item.name.endsWith('.xcarchive'))) {
      try {
        const archive = await readArchive(path.join(dir, entry.name));
        if (archive.scheme === scheme) archives.push(archive);
      } catch { /* Xcode may still be creating this archive. */ }
    }
  }
  return archives.sort((a, b) => (b.created || '').localeCompare(a.created || '') || b.path.localeCompare(a.path));
}

/** Only existing application archives inside Xcode's Organizer directory can be uploaded. */
export async function resolveArchive(archivePath, root = ARCHIVES_ROOT) {
  const realRoot = await fsp.realpath(root);
  const realArchive = await fsp.realpath(archivePath);
  const rel = path.relative(realRoot, realArchive);
  if (!rel || rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)
    || !realArchive.endsWith('.xcarchive') || !(await fsp.stat(realArchive)).isDirectory()) {
    throw new Error('Onbekend Xcode-archief.');
  }
  const archive = await readArchive(realArchive);
  if (!archive.uploadable) throw new Error(t('errors.noUploadableApp'));
  return archive;
}

/** Upload the chosen build through Xcode's configured account, preserving its build number. */
export function uploadScript(archivePath) {
  const options = build({ method: 'app-store-connect', destination: 'upload', signingStyle: 'automatic',
    manageAppVersionAndBuildNumber: false, uploadSymbols: true });
  return [
    'set -e',
    'xc_upload_dir=$(mktemp -d "${TMPDIR:-/tmp/}stellar-asc.XXXXXX")',
    'trap \'rm -rf "$xc_upload_dir"\' EXIT',
    `printf '%s' ${shellQuote(options)} > "$xc_upload_dir/ExportOptions.plist"`,
    `xcrun xcodebuild -exportArchive -archivePath ${shellQuote(archivePath)} -exportOptionsPlist "$xc_upload_dir/ExportOptions.plist" -exportPath "$xc_upload_dir/export" -allowProvisioningUpdates`,
    done(t('task.uploaded')),
  ].join('\n');
}

function xcodebuild(args, { cwd, timeout = QUICK_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/xcrun', ['xcodebuild', ...args], { cwd, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${stderr}`.trim().split('\n').filter((l) => /error/i.test(l)).join('\n') || err.message));
      else resolve(stdout);
    });
  });
}

/** Xcode projects in cwd (a few levels deep), with a workspace replacing the project next to it. */
export function findProjects(cwd) {
  const found = [];
  const queue = [{ dir: cwd, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < MAX_DIRS) {
    const { dir, depth } = queue.shift();
    visited += 1;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      continue;
    }
    const here = entries.filter((e) => /\.(xcworkspace|xcodeproj)$/.test(e.name));
    const hasWorkspace = here.some((e) => e.name.endsWith('.xcworkspace'));
    here
      .filter((e) => !(hasWorkspace && e.name.endsWith('.xcodeproj')))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((e) => {
        const kind = e.name.endsWith('.xcworkspace') ? 'workspace' : 'project';
        found.push({ path: path.relative(cwd, path.join(dir, e.name)), kind, name: e.name.replace(/\.(xcworkspace|xcodeproj)$/, '') });
      });
    if (depth < MAX_DEPTH) {
      entries
        .filter((e) => !e.name.startsWith('.') && !SKIP_DIRS.has(e.name) && !/\.(xcworkspace|xcodeproj|app|xcassets|framework)$/.test(e.name))
        .forEach((e) => queue.push({ dir: path.join(dir, e.name), depth: depth + 1 }));
    }
  }
  return found;
}

export function projectInfo(cwd) {
  const projects = cwd ? findProjects(cwd) : [];
  return { exists: projects.length > 0, projects };
}

/** Only a project found by findProjects can be used — never an arbitrary path from the renderer. */
function resolveContainer(cwd, rel) {
  const match = findProjects(cwd).find((p) => p.path === rel);
  if (!match) throw new Error(`Onbekend Xcode-project: ${rel}`);
  return { kind: match.kind, abs: path.join(cwd, match.path) };
}

const containerArgs = (c) => [c.kind === 'workspace' ? '-workspace' : '-project', c.abs];

/** .xcodeproj files a workspace refers to, without CocoaPods' Pods project. */
export function parseWorkspaceRefs(xml) {
  return [...xml.matchAll(/location\s*=\s*"(?:group|container):([^"]+)"/g)]
    .map((m) => m[1])
    .filter((ref) => ref.endsWith('.xcodeproj') && !/(^|\/)Pods\//.test(ref));
}

const listJson = async (args, cwd) => JSON.parse(await xcodebuild(['-list', '-json', ...args], { cwd }));

/**
 * Schemes and configurations. For a workspace only the schemes of its own projects count, so the
 * dozens of Pods schemes of an Expo/React Native app don't drown the app's scheme.
 */
export async function listSchemes(cwd, rel) {
  const container = resolveContainer(cwd, rel);
  if (container.kind === 'project') {
    const { project } = await listJson(containerArgs(container), cwd);
    return { schemes: project.schemes || [], configurations: project.configurations || [] };
  }
  const xml = await fsp.readFile(path.join(container.abs, 'contents.xcworkspacedata'), 'utf8').catch(() => '');
  const projects = parseWorkspaceRefs(xml)
    .map((ref) => path.join(path.dirname(container.abs), ref))
    .filter((p) => fs.existsSync(p));
  const lists = await Promise.all(projects.map((p) => listJson(['-project', p], cwd).then((r) => r.project).catch(() => null)));
  const schemes = [...new Set(lists.flatMap((l) => l?.schemes || []))];
  const configurations = [...new Set(lists.flatMap((l) => l?.configurations || []))];
  if (schemes.length) return { schemes, configurations: configurations.length ? configurations : ['Debug', 'Release'] };
  const { workspace } = await listJson(containerArgs(container), cwd);
  return { schemes: workspace.schemes || [], configurations: configurations.length ? configurations : ['Debug', 'Release'] };
}

/** The teams of the accounts in Xcode's settings, once each, sorted by name. */
export function parseTeams(prefs) {
  const byId = new Map();
  Object.values(prefs?.IDEProvisioningTeamByIdentifier || {}).flat()
    .filter((t) => TEAM_RE.test(t?.teamID || '') && !byId.has(t.teamID))
    .forEach((t) => byId.set(t.teamID, { id: t.teamID, name: t.teamName || t.teamID, personal: Boolean(t.isFreeProvisioningTeam) }));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Teams signed in to Xcode (Settings → Accounts); empty when Xcode has no accounts. */
export async function listTeams() {
  const xml = await new Promise((resolve) => {
    execFile('/usr/bin/defaults', ['export', 'com.apple.dt.Xcode', '-'], { timeout: QUICK_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : stdout));
  });
  return xml ? parseTeams(parse(xml)) : [];
}

/** Build setting for a chosen team; without one the project's own DEVELOPMENT_TEAM applies. */
export function teamArgs(team) {
  if (!team) return [];
  if (!TEAM_RE.test(team)) throw new Error('Ongeldig team.');
  return [`DEVELOPMENT_TEAM=${team}`];
}

/** Parses the "Available destinations" block of `xcodebuild -showdestinations`; null when there is none. */
export function parseDestinations(text) {
  const start = text.indexOf('Available destinations');
  if (start < 0) return null;
  const block = text.slice(start).split(/\n\s*\n/)[0];
  return [...block.matchAll(/\{ (.+) \}/g)]
    .map((m) => Object.fromEntries(m[1].split(/, (?=\w+:)/).map((kv) => {
      const i = kv.indexOf(':');
      return [kv.slice(0, i), kv.slice(i + 1)];
    })))
    // Variants like "Designed for [iPad,iPhone]" can't be expressed as a -destination value.
    .filter((d) => !d.variant)
    .map((d) => ({
      id: d.id && !d.id.startsWith('dvtdevice-') ? d.id : null,
      name: d.name,
      platform: d.platform,
      os: d.OS || null,
      generic: !d.id || d.id.startsWith('dvtdevice-'),
    }));
}

export async function listDestinations(cwd, rel, scheme) {
  const container = resolveContainer(cwd, rel);
  const output = await xcodebuild(['-showdestinations', ...containerArgs(container), '-scheme', scheme], { cwd });
  const list = parseDestinations(output);
  // Without the block Xcode was busy or said something else; show that instead of an empty list.
  if (!list) throw new Error(lastLines(output) || 'xcodebuild gaf geen bestemmingen terug.');
  return list;
}

const lastLines = (text, count = 5) => text.split('\n').map((l) => l.trim()).filter(Boolean).slice(-count).join('\n');

/** The -destination value; validated because it ends up in a shell command. */
export function destinationArg(d) {
  if (!d || !PLATFORM_RE.test(d.platform || '')) throw new Error('Ongeldige bestemming.');
  if (d.generic) return `generic/platform=${d.platform}`;
  if (!ID_RE.test(d.id || '')) throw new Error('Ongeldige bestemming.');
  return `platform=${d.platform},id=${d.id}`;
}

const pad = (n) => String(n).padStart(2, '0');

/** Same folder and name style as Xcode, so the archive shows up in the Organizer. */
export function archivePathFor(scheme, date = new Date()) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const stamp = `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}, ${pad(date.getHours())}.${pad(date.getMinutes())}`;
  return path.join(os.homedir(), 'Library/Developer/Xcode/Archives', day, `${scheme} ${stamp}.xcarchive`);
}

const isSimulator = (d) => / Simulator$/.test(d.platform);
const isMac = (d) => d.platform === 'macOS';
// Flags and actions stay bare so the command in the terminal is readable; every value is quoted.
const q = (args) => args.map((a) => (/^-\w+$/.test(a) || ACTIONS.includes(a) || /^DEVELOPMENT_TEAM=[A-Z0-9]+$/.test(a) ? a : shellQuote(a))).join(' ');

// xcbeautify keeps the output readable; without it, -quiet shows only warnings and errors.
const PRELUDE = [
  'set -o pipefail',
  'xb() { if command -v xcbeautify >/dev/null 2>&1; then xcodebuild "$@" | xcbeautify; else xcodebuild -quiet "$@"; fi; }',
].join('\n');

// The text goes into printf's format between single quotes: no quote, % or backslash.
const done = (text) => `printf '\\n\\033[32m✓ ${String(text).replace(/['%\\\\]/g, '')}\\033[0m\\n'`;

/** Shell script for one action. `app` (from build settings) is needed for run, `archivePath` for archive. */
export function taskScript({ action, container, scheme, configuration, destination, app, archivePath, team }) {
  if (!ACTIONS.includes(action)) throw new Error(`Onbekende actie: ${action}`);
  if (!destination) throw new Error('Kies een bestemming.');
  const base = [...containerArgs(container), '-scheme', scheme, '-configuration', configuration];
  const signing = !destination.generic && !isSimulator(destination) && !isMac(destination) ? ['-allowProvisioningUpdates'] : [];

  if (action === 'archive') {
    const platform = destination.platform.replace(/ Simulator$/, '');
    const args = [...base, '-destination', destinationArg({ platform, generic: true }), '-archivePath', archivePath, '-allowProvisioningUpdates', ...teamArgs(team), 'archive'];
    return `${PRELUDE}\nxb ${q(args)} && ${done(`Archief klaar: ${path.basename(archivePath)}`)} && open ${shellQuote(archivePath)}`;
  }
  const build = `xb ${q([...base, '-destination', destinationArg(destination), ...signing, ...teamArgs(team), action === 'run' ? 'build' : action])}`;
  if (action !== 'run') return `${PRELUDE}\n${build} && ${done(t('task.succeeded', { action }))}`;

  if (destination.generic) throw new Error('Kies een simulator of apparaat om te starten.');
  if (!app?.app || !app.bundleId) throw new Error('Geen app gevonden in dit scheme.');
  const { id } = destination;
  const launch = isSimulator(destination)
    ? [
      `{ xcrun simctl boot ${shellQuote(id)} 2>/dev/null; true; }`,
      'open -a Simulator',
      `xcrun simctl install ${shellQuote(id)} ${shellQuote(app.app)}`,
      `xcrun simctl launch --console-pty --terminate-running-process ${shellQuote(id)} ${shellQuote(app.bundleId)}`,
    ]
    : isMac(destination)
      ? [shellQuote(app.executable)]
      : [
        `xcrun devicectl device install app --device ${shellQuote(id)} ${shellQuote(app.app)}`,
        `xcrun devicectl device process launch --console --terminate-existing --device ${shellQuote(id)} ${shellQuote(app.bundleId)}`,
      ];
  return `${PRELUDE}\n${build} && ${done(t('task.builtStarting'))} && ${launch.join(' && ')}`;
}

/** Whether xcbeautify is on the login PATH (otherwise builds run with -quiet). */
export function hasFormatter() {
  return new Promise((resolve) => {
    execFile(SHELL, ['-lc', 'command -v xcbeautify'], { timeout: QUICK_TIMEOUT_MS }, (err) => resolve(!err));
  });
}

/** Built app, bundle id and executable of the scheme's app target for this destination. */
async function appSettings(cwd, args) {
  const targets = JSON.parse(await xcodebuild(['-showBuildSettings', '-json', ...args], { cwd }));
  const target = targets.find((t) => t.buildSettings?.WRAPPER_EXTENSION === 'app') || targets[0];
  const s = target?.buildSettings || {};
  if (!s.TARGET_BUILD_DIR || !s.FULL_PRODUCT_NAME) return null;
  return {
    app: path.join(s.TARGET_BUILD_DIR, s.FULL_PRODUCT_NAME),
    bundleId: s.PRODUCT_BUNDLE_IDENTIFIER || null,
    executable: s.EXECUTABLE_PATH ? path.join(s.TARGET_BUILD_DIR, s.EXECUTABLE_PATH) : null,
  };
}

/** Command for a terminal tab; validates project, scheme and configuration against xcodebuild itself. */
export async function taskCommand(cwd, { project, scheme, configuration, destination, action, archivePath, team }) {
  if (action === 'upload') {
    const archive = await resolveArchive(archivePath);
    return { command: SHELL, args: ['-lc', uploadScript(archive.path)] };
  }
  const container = resolveContainer(cwd, project);
  const { schemes, configurations } = await listSchemes(cwd, project);
  if (!schemes.includes(scheme)) throw new Error(`Onbekend scheme: ${scheme}`);
  if (!configurations.includes(configuration)) throw new Error(`Onbekende configuratie: ${configuration}`);
  if (team && !(await listTeams()).some((t) => t.id === team)) throw new Error(`Onbekend team: ${team}`);
  const opts = { action, container, scheme, configuration, destination, team };
  if (action === 'run') {
    const args = [...containerArgs(container), '-scheme', scheme, '-configuration', configuration, '-destination', destinationArg(destination), ...teamArgs(team)];
    opts.app = await appSettings(cwd, args);
  }
  if (action === 'archive') opts.archivePath = archivePathFor(scheme);
  return { command: SHELL, args: ['-lc', taskScript(opts)] };
}
