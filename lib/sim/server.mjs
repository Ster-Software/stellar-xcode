// The simulator's local HTTP server (the panel's MJPEG picture needs an address): boots iOS simulators headless,
// streams their screen and passes touches on. It runs inside the extension's own process: main.mjs starts it with
// startBridge() and stops it with stop() when Stellar stops the extension. The panel finds it through the extension
// (useExtension().call('bridge')), not by searching ports.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { BRIDGE_APP, BRIDGE_HOST, HOME_DIR, STATE_FILE } from './config.mjs';
import { acquireLock, findRunningBridge, listenOnFreePort, releaseLock } from './ports.mjs';
import { companionFor, pressButton, pressKeys, stopCompanion, touch } from './input.mjs';
import { runSetup, setupChecks, setupProgress } from './setup.mjs';
import {
  BOOT_PHASES, boot, createDevice, defaultSelection, findDevice, getAppearance, isValidSelection, listDevices, listRuntimes, setAppearance, shutdown, shutdownAll,
} from './sim.mjs';
import { serveStream, stopAllStreams, stopStream, streamGeneration } from './stream.mjs';

const BRIDGE_VERSION = 1;
/**
 * After the panel says goodbye: its simulators stop unless a panel comes back within this time. Stellar also unloads
 * a panel that goes behind another tab (the same goodbye as closing it), so this is long enough for a tab switch.
 * The server itself keeps running, for as long as the extension does.
 */
const GOODBYE_GRACE_MS = 10 * 60_000;
/** Safety net: the simulators stop when no panel has asked anything for this long. */
const IDLE_STOP_MS = 10 * 60_000;
const MAX_BODY_BYTES = 16 * 1024;

let state = { selection: null }; // { runtime, model }: the iOS version and model chosen in the panel
let busy = null; // 'opstarten' | 'afsluiten' while that runs
let bootPhase = null; // key of BOOT_PHASES while booting

async function loadState() {
  try {
    state = { ...state, ...JSON.parse(await readFile(STATE_FILE, 'utf8')) };
  } catch {
    // first run: no state yet
  }
}

async function saveState(next) {
  state = { ...state, ...next };
  await mkdir(HOME_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('Te groot verzoek.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Ongeldige JSON.')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Screen size and appearance of the running simulator. Fetching them can take seconds (the companion
 * starting, simctl ui waiting for SpringBoard), so /status reads them from here and they fill in later.
 */
let details = { udid: null, screen: null, appearance: null, loading: false };

function refreshDetails(udid) {
  if (details.loading) return;
  if (details.udid !== udid) details = { udid, screen: null, appearance: null, loading: false };
  details = { ...details, loading: true };
  Promise.all([
    details.screen ? details.screen : companionFor(udid).then((c) => c.screen).catch(() => null),
    getAppearance(udid),
  ]).then(([screen, appearance]) => {
    if (details.udid === udid) details = { udid, screen, appearance, loading: false };
  });
}

/** The current choice and the simulator that goes with it (null when it doesn't exist yet). */
async function resolve() {
  const [runtimes, devices] = await Promise.all([listRuntimes(), listDevices()]);
  const selection = isValidSelection(runtimes, state.selection) ? state.selection : defaultSelection(runtimes, devices);
  const device = selection ? findDevice(devices, selection) : null;
  return { runtimes, selection, device };
}

async function status() {
  const checks = await setupChecks();
  const ready = checks.platform && checks.xcode && checks.companion && checks.grpc;
  const boot = busy === 'opstarten' && bootPhase ? { phase: bootPhase, ...BOOT_PHASES[bootPhase] } : null;
  const base = { app: BRIDGE_APP, bridge: BRIDGE_VERSION, checks, ready, setup: setupProgress(), busy, boot, stream: streamGeneration() };
  if (!checks.xcode) return { ...base, runtimes: [], selection: null, device: null, screen: null, appearance: null };
  const { runtimes, selection, device } = await resolve();
  const live = ready && device?.booted && !busy;
  if (live) refreshDetails(device.udid);
  const known = live && details.udid === device.udid ? details : {};
  const screen = known.screen ?? null;
  const appearance = known.appearance ?? null;
  return { ...base, runtimes, selection, device, screen, appearance };
}

async function withBusy(label, work) {
  if (busy) throw new Error(`De simulator is al bezig met ${busy}.`);
  busy = label;
  try {
    return await work();
  } finally {
    busy = null;
  }
}

/** The booted simulator of the current choice, for requests that act on it. */
async function bootedDevice() {
  const { device } = await resolve();
  if (!device?.booted) throw new Error('De simulator staat uit.');
  return device;
}

const routes = {
  'GET /status': () => status(),
  'POST /setup': () => { runSetup(); return setupProgress(); },
  'POST /select': async ({ runtime, model }) => {
    const runtimes = await listRuntimes();
    if (!isValidSelection(runtimes, { runtime, model })) throw new Error('Dit model bestaat niet voor deze iOS-versie.');
    await saveState({ selection: { runtime, model } });
    return {};
  },
  'POST /boot': () => withBusy('opstarten', async () => {
    const { runtimes, selection, device } = await resolve();
    if (!selection) throw new Error('Geen iOS-versie of model gekozen.');
    await saveState({ selection });
    bootPhase = 'Starting';
    try {
      const udid = device?.udid ?? await createDevice(runtimes, selection);
      await boot(udid, (phase) => { bootPhase = phase; });
    } finally {
      bootPhase = null;
    }
    return {};
  }),
  'POST /shutdown': () => withBusy('afsluiten', async () => {
    const device = await bootedDevice();
    stopStream(device.udid);
    stopCompanion();
    await shutdown(device.udid);
    return {};
  }),
  'POST /appearance': async ({ appearance }) => {
    const { udid } = await bootedDevice();
    await setAppearance(udid, appearance);
    if (details.udid === udid) details = { ...details, appearance };
    return {};
  },
  'POST /touch': async ({ udid, phase, x, y }) => {
    if (!['down', 'move', 'up'].includes(phase)) throw new Error('phase moet down, move of up zijn.');
    await touch(udid, phase, x, y);
    return {};
  },
  'POST /button': async ({ button }) => { await pressButton((await bootedDevice()).udid, button); return {}; },
  'POST /keys': async ({ udid, keycodes }) => { await pressKeys(udid, keycodes); return {}; },
};

let goodbyeTimer = null;
let idleTimer = null;

/** Any request means a panel is there: cancel a pending goodbye and restart the idle clock. */
function panelSeen() {
  clearTimeout(goodbyeTimer);
  goodbyeTimer = null;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('Al 10 minuten geen paneel gezien: de simulators stoppen.');
    stopSimulators();
  }, IDLE_STOP_MS);
}

/** POST /bye, sent by the panel as it closes. */
function panelLeft() {
  clearTimeout(goodbyeTimer);
  goodbyeTimer = setTimeout(() => {
    console.log('Al 10 minuten geen paneel meer: de simulators stoppen.');
    stopSimulators();
  }, GOODBYE_GRACE_MS);
}

/**
 * Only the panel may drive the bridge: its sandboxed frame sends `Origin: null`. Requests from web pages
 * (a real origin) are refused, so a website can't boot simulators or tap on them. Tools like curl send no Origin.
 */
const allowedOrigin = (origin) => origin === undefined || origin === 'null';

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) { send(res, 403, { ok: false, error: 'Origin niet toegestaan.' }); return; }
  res.setHeader('Access-Control-Allow-Origin', 'null');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${BRIDGE_HOST}`);
  if (req.method === 'POST' && url.pathname === '/bye') {
    panelLeft();
    res.writeHead(204);
    res.end();
    return;
  }
  panelSeen();
  try {
    if (req.method === 'GET' && url.pathname === '/stream') {
      serveStream(url.searchParams.get('udid'), res);
      return;
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) { send(res, 404, { ok: false, error: 'Niet gevonden.' }); return; }
    const body = req.method === 'POST' ? await readBody(req) : {};
    send(res, 200, { ok: true, data: await route(body) });
  } catch (error) {
    console.error(`[bridge] ${req.method} ${url.pathname}:`, error.message);
    send(res, 400, { ok: false, error: error.message });
  }
});

/** Stops what the panel started (the stream, the companion, the panel's simulators); the server stays. */
async function stopSimulators() {
  clearTimeout(goodbyeTimer);
  clearTimeout(idleTimer);
  stopAllStreams();
  stopCompanion();
  await shutdownAll();
}

let url = null;

/**
 * Starts the server on the first free port of its range: `{ url, own }`. Another bridge that runs already (the old
 * panel's, started in a terminal) is used instead: `own` false.
 */
export async function startBridge() {
  if (url) return { url, own: true };
  if (!acquireLock()) {
    const running = await findRunningBridge();
    if (!running) throw new Error('Een andere simulator-bridge houdt het slot vast, maar antwoordt niet.');
    return { url: `http://${BRIDGE_HOST}:${running}`, own: false };
  }
  await loadState();
  const port = await listenOnFreePort(server);
  server.on('error', (error) => console.error('[bridge]', error));
  panelSeen();
  url = `http://${BRIDGE_HOST}:${port}`;
  console.log(`Simulator-bridge draait op ${url}.`);
  return { url, own: true };
}

/** Where the server runs (null before startBridge). */
export const bridgeUrl = () => url;

/** Stops everything: the simulators, the server and the lock (deactivate). */
export async function stopBridge() {
  if (!url) return;
  url = null;
  // First no new requests (the panel then says the bridge is gone), then the simulators, which takes a few seconds.
  server.closeAllConnections();
  const closed = new Promise((resolve) => { server.close(() => resolve()); });
  releaseLock();
  await Promise.all([closed, stopSimulators()]);
}
