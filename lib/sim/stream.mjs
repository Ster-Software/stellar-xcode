// Live picture of a booted simulator: idb's sim-video writes JPEG frames, which go out as MJPEG
// (multipart/x-mixed-replace) to every <img> that watches.
import { spawn } from 'node:child_process';
import { DEVICE_SET, SIM_VIDEO_BIN, STREAM_IDLE_MS, STREAM_QUALITY, STREAM_SCALE } from './config.mjs';
import { assertUdid } from './sim.mjs';

const BOUNDARY = 'simframe';
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** Splits a byte stream of back-to-back JPEGs into frames. */
function jpegSplitter(onFrame) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const start = buffer.indexOf(SOI);
      if (start < 0) { buffer = Buffer.alloc(0); return; }
      const end = buffer.indexOf(EOI, start + 2);
      if (end < 0) { buffer = buffer.subarray(start); return; }
      onFrame(buffer.subarray(start, end + 2));
      buffer = buffer.subarray(end + 2);
    }
  };
}

function writeFrame(res, frame) {
  res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
  res.write(frame);
  res.write('\r\n');
}

/** One sim-video process per simulator, shared by all viewers. */
class Stream {
  constructor(udid, onEnd) {
    this.udid = udid;
    this.viewers = new Set();
    this.lastFrame = null;
    this.idleTimer = null;
    this.onEnd = onEnd;
    this.process = spawn(SIM_VIDEO_BIN, [
      'stream', '--set', DEVICE_SET, '--udid', udid, '--encoding', 'mjpeg',
      '--scale', String(STREAM_SCALE), '--compression-quality', String(STREAM_QUALITY), '-',
    ], { stdio: ['pipe', 'pipe', 'pipe'] }); // stdin stays open: sim-video stops when it closes
    this.process.stdout.on('data', jpegSplitter((frame) => {
      this.lastFrame = Buffer.from(frame);
      for (const res of this.viewers) writeFrame(res, this.lastFrame);
    }));
    this.process.stderr.on('data', () => {}); // chatty; errors show up as the exit below
    this.process.on('exit', (code) => {
      if (code) console.error(`[stream] sim-video for ${udid} stopped (${code})`);
      for (const res of this.viewers) res.end();
      this.viewers.clear();
      this.onEnd(this);
    });
  }

  add(res) {
    clearTimeout(this.idleTimer);
    this.viewers.add(res);
    if (this.lastFrame) writeFrame(res, this.lastFrame);
    res.on('close', () => {
      this.viewers.delete(res);
      if (this.viewers.size === 0) this.idleTimer = setTimeout(() => this.stop(), STREAM_IDLE_MS);
    });
  }

  stop() {
    clearTimeout(this.idleTimer);
    this.process.stdin.end();
    setTimeout(() => this.process.kill(), 2000).unref();
  }
}

const streams = new Map();
/** Goes up each time a stream ends, so the panel knows to reconnect its picture. */
let generation = 0;
export const streamGeneration = () => generation;

/** Handles GET /stream?udid=… */
export function serveStream(udid, res) {
  assertUdid(udid);
  let stream = streams.get(udid);
  if (!stream) {
    stream = new Stream(udid, (ended) => {
      generation += 1;
      if (streams.get(udid) === ended) streams.delete(udid);
    });
    streams.set(udid, stream);
  }
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  stream.add(res);
}

export function stopStream(udid) {
  streams.get(udid)?.stop();
}

export function stopAllStreams() {
  for (const stream of streams.values()) stream.stop();
}
