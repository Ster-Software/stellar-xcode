// The simulators themselves, through xcrun simctl. Booting this way is headless: Simulator.app stays closed.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { COMPANION_BIN, DEVICE_SET } from './config.mjs';
import { run } from './exec.mjs';

/** simctl on the panel's private device set. */
function simctl(args, options) {
  mkdirSync(DEVICE_SET, { recursive: true });
  return run('xcrun', ['simctl', '--set', DEVICE_SET, ...args], options);
}

const UDID = /^[0-9A-F-]{36}$/i;
const APPEARANCES = ['light', 'dark'];
const FAMILIES = ['iPhone', 'iPad'];
const PREFERRED_MODEL = 'iPhone 17';
const APPEARANCE_TIMEOUT_MS = 5000;
const BOOT_TIMEOUT_MS = 300_000;
const SHUTDOWN_ALL_TIMEOUT_MS = 60_000;

export function assertUdid(udid) {
  if (typeof udid !== 'string' || !UDID.test(udid)) throw new Error('Ongeldige simulator-id.');
  return udid;
}

const compareVersions = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Installed iOS versions, newest first, each with the iPhone and iPad models it can run.
 * simctl can list one identifier twice (26.4 and 26.4.1): the newest version wins.
 */
export async function listRuntimes() {
  const json = JSON.parse(await run('xcrun', ['simctl', 'list', 'runtimes', 'available', '-j']));
  const byId = new Map();
  for (const runtime of json.runtimes) {
    if (runtime.platform !== 'iOS' || !runtime.isAvailable) continue;
    const known = byId.get(runtime.identifier);
    if (known && compareVersions(known.version, runtime.version) >= 0) continue;
    byId.set(runtime.identifier, {
      id: runtime.identifier,
      version: runtime.version,
      name: runtime.name,
      models: runtime.supportedDeviceTypes
        .filter((type) => FAMILIES.includes(type.productFamily))
        .map((type) => ({ id: type.identifier, name: type.name, family: type.productFamily })),
    });
  }
  return [...byId.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/** Every simulator that can run, with its model and iOS version. */
export async function listDevices() {
  const json = JSON.parse(await simctl(['list', 'devices', 'available', '-j']));
  return Object.entries(json.devices).flatMap(([runtime, list]) => list.map((device) => ({
    udid: device.udid,
    name: device.name,
    runtime,
    model: device.deviceTypeIdentifier,
    booted: device.state === 'Booted',
  })));
}

/** The simulator for a choice of iOS version and model: a booted one, else one named after the model, else any. */
export function findDevice(devices, { runtime, model }) {
  const matches = devices.filter((d) => d.runtime === runtime && d.model === model);
  return matches.find((d) => d.booted) ?? matches.sort((a, b) => a.name.length - b.name.length)[0] ?? null;
}

/** A sensible first choice: what is running already, else the newest iOS with an iPhone 17. */
export function defaultSelection(runtimes, devices) {
  const booted = devices.find((d) => d.booted && runtimes.some((r) => r.id === d.runtime));
  if (booted) return { runtime: booted.runtime, model: booted.model };
  const runtime = runtimes[0];
  if (!runtime) return null;
  const model = runtime.models.find((m) => m.name === PREFERRED_MODEL) ?? runtime.models.find((m) => m.family === 'iPhone') ?? runtime.models[0];
  return model ? { runtime: runtime.id, model: model.id } : null;
}

export function isValidSelection(runtimes, selection) {
  const runtime = runtimes.find((r) => r.id === selection?.runtime);
  return Boolean(runtime?.models.some((m) => m.id === selection.model));
}

/** Makes a new simulator for this model and iOS version; returns its udid. */
export async function createDevice(runtimes, { runtime, model }) {
  const type = runtimes.find((r) => r.id === runtime)?.models.find((m) => m.id === model);
  if (!type) throw new Error('Dit model bestaat niet voor deze iOS-versie.');
  return assertUdid((await simctl(['create', type.name, model, runtime])).trim());
}

/** Boot phases as idb-companion logs them, with a label and roughly how far along they are. */
export const BOOT_PHASES = {
  Starting: { label: 'Simulator starten', progress: 0.05 },
  Booting: { label: 'iOS opstarten', progress: 0.2 },
  WaitingOnDataMigration: { label: 'Gegevens bijwerken', progress: 0.4 },
  WaitingOnBackboard: { label: 'Scherm voorbereiden', progress: 0.6 },
  WaitingOnSystemApp: { label: 'Beginscherm laden', progress: 0.85 },
  Finished: { label: 'Klaar', progress: 1 },
};
const BOOT_STATUS = /Boot Status Changed: (\w+)/;

/**
 * Boots headless through idb-companion: unlike a bare `simctl boot` that also sets up the display surface
 * the video stream reads, and it returns once SpringBoard is up. onPhase gets each BOOT_PHASES key.
 */
export function boot(udid, onPhase = () => {}) {
  assertUdid(udid);
  onPhase('Starting');
  return new Promise((resolve, reject) => {
    const child = spawn(COMPANION_BIN, ['--boot', udid, '--device-set-path', DEVICE_SET, '--log-level', 'info'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => child.kill(), BOOT_TIMEOUT_MS);
    let tail = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => {
      tail = (tail + text).slice(-2000);
      for (const line of text.split('\n')) {
        const phase = BOOT_STATUS.exec(line)?.[1];
        if (phase && BOOT_PHASES[phase]) onPhase(phase);
      }
    });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Opstarten mislukt: ${tail.trim().split('\n').pop() || `code ${code}`}`));
    });
  });
}

export async function shutdown(udid) {
  await simctl(['shutdown', assertUdid(udid)]).catch((error) => {
    if (!/current state: Shutdown/i.test(error.message)) throw error;
  });
}

/** Shuts down every simulator of the panel's own device set (never the user's Xcode simulators). */
export async function shutdownAll() {
  await simctl(['shutdown', 'all'], { timeout: SHUTDOWN_ALL_TIMEOUT_MS }).catch((error) => console.error('[sim] shutdown all:', error.message));
}

export async function getAppearance(udid) {
  // simctl ui can hang while SpringBoard isn't fully up: give up quickly.
  const out = await simctl(['ui', assertUdid(udid), 'appearance'], { timeout: APPEARANCE_TIMEOUT_MS }).catch(() => '');
  const value = out.trim();
  return APPEARANCES.includes(value) ? value : null;
}

export async function setAppearance(udid, appearance) {
  if (!APPEARANCES.includes(appearance)) throw new Error('Weergave moet light of dark zijn.');
  await simctl(['ui', assertUdid(udid), 'appearance', appearance], { timeout: APPEARANCE_TIMEOUT_MS });
}
