// Touches, buttons and keys, sent to the simulator through idb-companion's gRPC `hid` stream.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { COMPANION_BIN, DEVICE_SET, NODE_DIR, PROTO_FILE } from './config.mjs';
import { freePort } from './ports.mjs';
import { assertUdid } from './sim.mjs';

const CONNECT_TIMEOUT_MS = 20_000;
const RETRY_MS = 300;
const BUTTONS = ['HOME', 'LOCK', 'SIDE_BUTTON', 'SIRI', 'VOLUME_UP', 'VOLUME_DOWN'];

let grpcModule = null;
function loadGrpc() {
  if (grpcModule) return grpcModule;
  const require = createRequire(join(NODE_DIR, 'package.json'));
  const grpc = require('@grpc/grpc-js');
  const loader = require('@grpc/proto-loader');
  const definition = loader.loadSync(PROTO_FILE, { keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true });
  grpcModule = { grpc, idb: grpc.loadPackageDefinition(definition).idb };
  return grpcModule;
}

/** The one running companion (for one simulator) and its client. */
let companion = null; // { udid, process, client, ready: Promise, screen }
/** The touch currently held down: an open hid call. */
let gesture = null;

function describe(client) {
  return new Promise((resolve, reject) => {
    client.describe({}, { deadline: Date.now() + 3000 }, (error, response) => (error ? reject(error) : resolve(response)));
  });
}

async function waitForCompanion(client) {
  const until = Date.now() + CONNECT_TIMEOUT_MS;
  for (;;) {
    try {
      return await describe(client);
    } catch (error) {
      if (Date.now() > until) throw new Error(`idb-companion antwoordt niet: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

function startCompanion(udid) {
  stopCompanion();
  const entry = { udid, process: null, client: null, screen: null, ready: null };
  entry.ready = freePort().then((port) => {
    if (companion !== entry) throw new Error('idb-companion is vervangen.');
    const { grpc, idb } = loadGrpc();
    entry.process = spawn(COMPANION_BIN, ['--udid', udid, '--device-set-path', DEVICE_SET, '--grpc-port', String(port), '--log-level', 'info'], { stdio: 'ignore' });
    entry.process.on('exit', () => { if (companion === entry) companion = null; });
    entry.client = new idb.CompanionService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
    return waitForCompanion(entry.client);
  }).then((response) => {
    entry.screen = response.target_description?.screen_dimensions ?? null;
    return entry;
  });
  entry.ready.catch(() => { if (companion === entry) stopCompanion(); });
  companion = entry;
  return entry;
}

export function stopCompanion() {
  if (!companion) return;
  gesture = null;
  companion.client?.close();
  companion.process?.kill();
  companion = null;
}

/** The companion for this simulator, started when needed. */
export function companionFor(udid) {
  assertUdid(udid);
  const entry = companion?.udid === udid ? companion : startCompanion(udid);
  return entry.ready;
}

/** Screen size in points, e.g. { width_points: 420, height_points: 912 }. */
export async function screenOf(udid) {
  return (await companionFor(udid)).screen;
}

const touchEvent = (x, y, direction) => ({ press: { action: { touch: { point: { x, y } } }, direction } });

function openHid(client) {
  return client.hid((error) => { if (error) console.error('[input] hid:', error.message); });
}

/** phase: 'down' | 'move' | 'up', x/y in points. */
export async function touch(udid, phase, x, y) {
  if (![x, y].every(Number.isFinite)) throw new Error('x en y moeten getallen zijn.');
  const { client } = await companionFor(udid);
  if (phase === 'down') {
    gesture?.end();
    gesture = openHid(client);
    gesture.write(touchEvent(x, y, 'DOWN'));
    return;
  }
  if (!gesture) return; // a move or up without a down (e.g. after a restart): ignore
  if (phase === 'move') {
    gesture.write(touchEvent(x, y, 'DOWN'));
    return;
  }
  gesture.write(touchEvent(x, y, 'UP'));
  gesture.end();
  gesture = null;
}

/** One complete HID sequence (button or key press) on its own call. */
async function sendEvents(udid, events) {
  const { client } = await companionFor(udid);
  await new Promise((resolve, reject) => {
    const call = client.hid((error) => (error ? reject(error) : resolve()));
    for (const event of events) call.write(event);
    call.end();
  });
}

export async function pressButton(udid, button) {
  if (!BUTTONS.includes(button)) throw new Error(`Onbekende knop: ${button}`);
  const press = (direction) => ({ press: { action: { button: { button } }, direction } });
  await sendEvents(udid, [press('DOWN'), press('UP')]);
}

/** keycodes: USB HID usages, pressed in order and released in reverse (so [SHIFT, A] gives "A"). */
export async function pressKeys(udid, keycodes) {
  if (!Array.isArray(keycodes) || keycodes.length === 0 || !keycodes.every((k) => Number.isInteger(k) && k > 0 && k < 256)) {
    throw new Error('keycodes moet een lijst HID-codes zijn.');
  }
  const key = (keycode, direction) => ({ press: { action: { key: { keycode } }, direction } });
  await sendEvents(udid, [...keycodes.map((k) => key(k, 'DOWN')), ...[...keycodes].reverse().map((k) => key(k, 'UP'))]);
}
