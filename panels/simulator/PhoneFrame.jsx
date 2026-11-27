// The phone around the screen, as in the React version (src/iphone/DeviceFrame.tsx, measured from a Simulator
// window): black glass band, graphite rim with a light outer edge, antenna gaps and the side buttons. Built at
// 1:1 in points and scaled to fit the space it gets. The side and volume buttons press the simulator's buttons.
import { useEffect, useRef, useState } from 'react';
import { useT } from 'stellar';

/** iPhone 17 screen, in points; used until the bridge reports the real one. */
export const DEFAULT_SCREEN = { width: 402, height: 874 };

/** SIMULATOR_FRAME in src/iphone/device.ts. */
const FRAME = {
  border: 9.4,
  rim: 6.8,
  rimHighlight: 1.4,
  buttonDepth: 4.7,
  buttonHoverDepth: 9.4,
  buttons: [
    { kind: 'action', side: 'left', top: 163.3, length: 32.4 },
    { kind: 'volumeUp', side: 'left', top: 251.2, length: 62.8, button: 'VOLUME_UP', label: 'sim.volumeUp' },
    { kind: 'volumeDown', side: 'left', top: 337.5, length: 62.3, button: 'VOLUME_DOWN', label: 'sim.volumeDown' },
    { kind: 'side', side: 'right', top: 276.3, length: 99.4, button: 'LOCK', label: 'sim.sideButton' },
  ],
  antennaInset: 77,
  antennaWidth: 5.8,
};

/** Display corner radius per screen width in points (device.ts); other screens get the iPhone 17's proportion. */
const SCREEN_RADIUS = { 402: 55, 420: 60, 440: 62 };
const screenRadius = (width) => SCREEN_RADIUS[width] ?? (55 / 402) * width;

const OUTER = FRAME.border + FRAME.rim;
/** Room around the screen: the frame plus the buttons at full hover depth. */
const EXTRA = OUTER + FRAME.buttonHoverDepth;
const MARGIN = 8;

// The side buttons: pushed back under the rim at rest (--rest), out on hover or focus, pressed in a pixel on a click.
const BUTTON = 'absolute border-0 bg-[#2c2c2c] p-0 shadow-[inset_0_0_0_0.5px_#141414] translate-x-(--rest) transition-[translate] duration-120 ease-out';
const SIDE = { left: 'rounded-l-[1.5px]', right: 'rounded-r-[1.5px]' };
const PRESSABLE = 'cursor-pointer outline-none hover:translate-x-0 focus-visible:translate-x-0 active:duration-40';
const PRESSED = { left: 'active:translate-x-px', right: 'active:-translate-x-px' };

function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function antennas(width, height) {
  const { antennaInset: a, antennaWidth: aw, rim } = FRAME;
  const vertical = (edge, at) => ({ [edge]: -OUTER, top: at, width: rim, height: aw });
  const horizontal = (edge, at) => ({ [edge]: -OUTER, left: at, width: aw, height: rim });
  return [
    vertical('left', a), vertical('left', height - a - aw),
    vertical('right', a), vertical('right', height - a - aw),
    horizontal('top', width - a - aw), horizontal('bottom', a),
  ];
}

function FrameButton({ spec, onButton }) {
  const t = useT();
  // Drawn at full hover depth and pushed back under the rim at rest; the extra 1 pt hides the seam.
  const style = {
    [spec.side]: -(OUTER + FRAME.buttonHoverDepth),
    top: spec.top,
    height: spec.length,
    width: FRAME.buttonHoverDepth + 1,
    '--rest': `${(FRAME.buttonHoverDepth - FRAME.buttonDepth) * (spec.side === 'left' ? 1 : -1)}px`,
  };
  const className = `${BUTTON} ${SIDE[spec.side]}`;
  if (!spec.button || !onButton) return <span aria-hidden className={className} style={style} />;
  return <button type="button" title={t(spec.label)} aria-label={t(spec.label)} className={`${className} ${PRESSABLE} ${PRESSED[spec.side]}`} style={style} onClick={() => onButton(spec.button)} />;
}

/**
 * children: the screen content, laid out in points and scaled with the phone.
 * overlay: shown over the screen at the panel's own size (readable text and buttons however small the phone is);
 * it lets clicks through except where its own elements set pointerEvents: 'auto'.
 * onButton(name) gets 'LOCK', 'VOLUME_UP' or 'VOLUME_DOWN'; without it the buttons are only drawn.
 */
export function PhoneFrame({ screen = DEFAULT_SCREEN, onButton, overlay, children }) {
  const box = useRef(null);
  const size = useSize(box);
  const { width, height } = screen;
  const radius = screenRadius(width);
  const scale = Math.max(0, Math.min((size.width - MARGIN * 2) / (width + EXTRA * 2), (size.height - MARGIN * 2) / (height + EXTRA * 2)));

  return (
    <div ref={box} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {scale > 0 && (
        <div style={{ position: 'relative', width: (width + EXTRA * 2) * scale, height: (height + EXTRA * 2) * scale, flex: 'none' }}>
          <div style={{ position: 'absolute', left: EXTRA * scale, top: EXTRA * scale, width, height, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            {FRAME.buttons.map((spec) => <FrameButton key={spec.kind} spec={spec} onButton={onButton} />)}
            <div aria-hidden style={{
              position: 'absolute', inset: -OUTER, borderRadius: radius + OUTER, background: '#2c2c2c',
              boxShadow: `inset 0 0 0 0.5px #4d4d4d, inset 0 0 0 ${FRAME.rimHighlight}px #747474, 0 30px 80px rgba(0, 0, 0, 0.35)`,
            }} />
            {antennas(width, height).map((style, i) => <span key={i} aria-hidden style={{ position: 'absolute', background: '#1e1e1e', ...style }} />)}
            <div aria-hidden style={{ position: 'absolute', inset: -FRAME.border, borderRadius: radius + FRAME.border, background: '#000' }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden', background: '#000' }}>
              {children}
            </div>
          </div>
          {overlay && (
            <div style={{
              position: 'absolute', left: EXTRA * scale, top: EXTRA * scale, width: width * scale, height: height * scale,
              borderRadius: radius * scale, overflow: 'hidden', pointerEvents: 'none',
            }}>
              {overlay}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
