// Talks to the simulator bridge, which runs in the extension's own process (lib/server.mjs, started by main.mjs).
import { useEffect, useState } from 'react';

const POLL_MS = 1500;

/** Where the bridge runs, as the extension's main code says (setBridge); null until it did. */
let bridgeUrl = null;
let found = null;
const waiting = new Promise((resolve) => { found = resolve; });

/** The extension told where its bridge runs (index.jsx asks it with useExtension().call('bridge')). */
export function setBridge(url) {
  bridgeUrl = url;
  found(url);
}

export async function call(path, body) {
  const url = bridgeUrl ?? await waiting;
  let response;
  try {
    response = await fetch(`${url}${path}`, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (error) {
    throw new Error(`De simulator-bridge antwoordt niet (${error.message}).`);
  }
  const json = await response.json().catch(() => ({ ok: false, error: `Bridge gaf ${response.status}` }));
  if (!json.ok) throw new Error(json.error || 'Onbekende fout van de bridge.');
  return json.data;
}

/** Tells the bridge this panel is going away (it stops itself unless a panel comes back soon). */
export function sayGoodbye() {
  // sendBeacon still goes out while the frame is being torn down; plain text, so no CORS preflight.
  if (bridgeUrl) navigator.sendBeacon(`${bridgeUrl}/bye`, '');
}

/** Only used once /status answered, so the bridge's URL is known. */
export const streamUrl = (udid) => `${bridgeUrl}/stream?udid=${encodeURIComponent(udid)}`;

/**
 * Polls GET /status. Returns { online: undefined | boolean, status, refresh }:
 * online undefined while the first poll runs, false when the bridge doesn't answer.
 */
export function useBridge() {
  const [online, setOnline] = useState(undefined);
  const [status, setStatus] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer = null;
    const poll = async () => {
      try {
        const next = await call('/status');
        if (!alive) return;
        setStatus(next);
        setOnline(true);
      } catch {
        if (!alive) return;
        setOnline(false);
        setStatus(null);
      }
      if (alive) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [tick]);
  return { online, status, refresh: () => setTick((t) => t + 1) };
}

/** True when the screen can be shown and used. */
export function isLive(online, status) {
  return Boolean(online && status?.ready && status.device?.booted && !status.busy);
}
