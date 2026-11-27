// A real iOS Simulator, headless, in a panel of the simulator extension. The bridge runs in the extension's own
// process (main.mjs, lib/server.mjs); this panel asks it where.
import { useEffect, useState } from 'react';
import { useExtension, usePanelEvent } from 'stellar';
import { call, isLive, sayGoodbye, setBridge, useBridge } from '../../shared/api.js';
import { LiveScreen } from './LiveScreen.jsx';
import { DEFAULT_SCREEN, PhoneFrame } from './PhoneFrame.jsx';
import { ErrorBar, PlayOverlay } from './PlayOverlay.jsx';
import { SetupCheck } from './SetupCheck.jsx';

/** Lets the panel's `height: 100%` reach the frame's full height: html > body > #root (12px padding) > panel. */
const FULL_HEIGHT_CSS = 'html, body, #root { height: 100%; } #root { box-sizing: border-box; }';

function screenPoints(status) {
  const screen = status?.screen;
  return screen?.width_points ? { width: screen.width_points, height: screen.height_points } : DEFAULT_SCREEN;
}

export default function Simulator() {
  const extension = useExtension();
  const [bridgeError, setBridgeError] = useState(null);
  useEffect(() => { extension.call('bridge').then(({ url }) => setBridge(url), (e) => setBridgeError(e.message)); }, [extension]);
  const { online, status, refresh } = useBridge();
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  // A hidden panel can lose its picture connection: reconnect as soon as it is shown again.
  // (Not on focus: a tap on the screen focuses the panel, and reconnecting would cut through it.)
  const [connection, setConnection] = useState(0);
  const reconnect = () => setConnection((n) => n + 1);
  usePanelEvent('show', reconnect);
  // Closing the panel stops the bridge and the simulator, after a grace period: Stellar also unloads the panel
  // behind another tab or on a reload, and coming back within that time keeps everything running.
  useEffect(() => {
    window.addEventListener('pagehide', sayGoodbye);
    return () => window.removeEventListener('pagehide', sayGoodbye);
  }, []);

  if (online === undefined && !bridgeError) return null;
  if (!online || !status?.ready) {
    return (
      <div style={{ height: '100%', overflow: 'auto' }}>
        <style>{FULL_HEIGHT_CSS}</style>
        <SetupCheck online={Boolean(online)} status={status} bridgeError={bridgeError} />
      </div>
    );
  }

  const live = isLive(online, status);
  const busy = status.busy ?? (starting ? 'opstarten' : null);
  const act = async (path, body) => {
    setError(null);
    try {
      await call(path, body);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };
  const play = async () => {
    setError(null);
    setStarting(true);
    try {
      await call('/boot', {});
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{FULL_HEIGHT_CSS}</style>
      <PhoneFrame
        screen={screenPoints(status)}
        onButton={live ? (button) => act('/button', { button }) : undefined}
        overlay={(
          <>
            {!live && <PlayOverlay busy={busy} boot={status.boot} onPlay={play} />}
            <ErrorBar message={error} onClose={() => setError(null)} />
          </>
        )}>
        {live && <LiveScreen key={`${status.device.udid}-${status.stream}-${connection}`} udid={status.device.udid} screen={screenPoints(status)} onError={setError} />}
      </PhoneFrame>
    </div>
  );
}
