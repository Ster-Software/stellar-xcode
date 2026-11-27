// The simulator's live picture, passing mouse/trackpad gestures and typing on to it.
import { useEffect, useRef } from 'react';
import { useT } from 'stellar';
import { call, streamUrl } from '../../shared/api.js';
import { keycodesFor } from './keys.js';

/** A drag up that starts this close to the bottom edge (pt) goes home, as on a real iPhone. */
const HOME_EDGE = 24;
const HOME_DISTANCE = 60;

/** Sends requests one after another, so a touch's down, moves and up arrive in order. */
function useSerialQueue(onError) {
  const tail = useRef(Promise.resolve());
  return (task) => {
    tail.current = tail.current.then(task).catch((error) => onError(error.message));
  };
}

export function LiveScreen({ udid, screen, onError }) {
  const t = useT();
  const area = useRef(null);
  const down = useRef(false);
  const pendingMove = useRef(null);
  const frame = useRef(0);
  const start = useRef(null);
  const enqueue = useSerialQueue(onError);

  const toPoints = (event) => {
    const rect = area.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * screen.width;
    const y = ((event.clientY - rect.top) / rect.height) * screen.height;
    return { x: Math.min(screen.width, Math.max(0, x)), y: Math.min(screen.height, Math.max(0, y)) };
  };
  const sendTouch = (phase, point) => enqueue(() => call('/touch', { udid, phase, ...point }));

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    area.current.focus();
    area.current.setPointerCapture(event.pointerId);
    down.current = true;
    start.current = toPoints(event);
    sendTouch('down', start.current);
  };
  const onPointerMove = (event) => {
    if (!down.current) return;
    pendingMove.current = toPoints(event);
    if (frame.current) return;
    // At most one move per animation frame.
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pendingMove.current && down.current) sendTouch('move', pendingMove.current);
      pendingMove.current = null;
    });
  };
  const onPointerUp = (event) => {
    if (!down.current) return;
    down.current = false;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    pendingMove.current = null;
    const end = toPoints(event);
    sendTouch('up', end);
    // Injected touches don't trigger iOS's home gesture, so do what it would: press Home.
    const from = start.current;
    if (from && from.y >= screen.height - HOME_EDGE && from.y - end.y >= HOME_DISTANCE) pressHome();
    start.current = null;
  };
  const pressHome = () => enqueue(() => call('/button', { button: 'HOME' }));
  const onKeyDown = (event) => {
    if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'h') { event.preventDefault(); pressHome(); return; }
    const keycodes = keycodesFor(event);
    if (!keycodes) return;
    event.preventDefault();
    enqueue(() => call('/keys', { udid, keycodes }));
  };

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return (
    <div ref={area} tabIndex={0} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', inset: 0, outline: 'none', touchAction: 'none', cursor: 'default' }}>
      <img src={streamUrl(udid)} alt="" draggable={false} onError={() => onError(t('sim.streamLost'))}
        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill', pointerEvents: 'none', userSelect: 'none' }} />
    </div>
  );
}
