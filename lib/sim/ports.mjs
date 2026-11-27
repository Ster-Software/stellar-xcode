// Finding ports: the bridge takes the first free one of a small range the panel knows to search,
// the companion gets whatever port the system hands out.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { createServer } from 'node:net';
import { BRIDGE_APP, BRIDGE_HOST, BRIDGE_PORTS, HOME_DIR, LOCK_FILE } from './config.mjs';

const PROBE_TIMEOUT_MS = 800;

/** The port of a simulator bridge that already runs in the range, or null. */
export async function findRunningBridge() {
  const answers = await Promise.all(BRIDGE_PORTS.map(async (port) => {
    try {
      const response = await fetch(`http://${BRIDGE_HOST}:${port}/status`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      const json = await response.json();
      return json?.data?.app === BRIDGE_APP ? port : null;
    } catch {
      return null;
    }
  }));
  return answers.find((port) => port !== null) ?? null;
}

/** Listens on the first free port of the range; resolves with that port. */
export async function listenOnFreePort(server) {
  for (const port of BRIDGE_PORTS) {
    const ok = await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        if (error.code === 'EADDRINUSE') resolve(false);
        else reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve(true);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, BRIDGE_HOST);
    });
    if (ok) return port;
  }
  throw new Error(`Geen vrije poort tussen ${BRIDGE_PORTS[0]} en ${BRIDGE_PORTS.at(-1)}.`);
}

/** A port the system says is free right now (for the companion's gRPC server). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, BRIDGE_HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/**
 * Makes this the only bridge: creates the lock file atomically with our pid. Two bridges started at the same
 * moment (two copies of the panel) can't both get it. A lock left by a bridge that died is taken over.
 * Returns false when another live bridge holds it.
 */
export function acquireLock() {
  mkdirSync(HOME_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(LOCK_FILE, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const holder = Number(readFileSync(LOCK_FILE, 'utf8').trim());
      if (!holder) return false; // just being written by a bridge starting this very moment
      if (holder !== process.pid && isAlive(holder)) return false;
      rmSync(LOCK_FILE, { force: true }); // stale: its bridge is gone
    }
  }
  return false;
}

export function releaseLock() {
  try {
    if (Number(readFileSync(LOCK_FILE, 'utf8').trim()) === process.pid) rmSync(LOCK_FILE, { force: true });
  } catch {
    // no lock (anymore): nothing to release
  }
}
