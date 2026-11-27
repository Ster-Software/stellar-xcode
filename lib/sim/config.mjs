// Shared settings of the simulator bridge (see README.md next to this file).
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BRIDGE_HOST = '127.0.0.1';
/** The bridge takes the first free port of this range; the panel searches the same range (api.js). */
export const BRIDGE_PORT_FIRST = 5199;
export const BRIDGE_PORT_COUNT = 10;
export const BRIDGE_PORTS = Array.from({ length: BRIDGE_PORT_COUNT }, (_, i) => BRIDGE_PORT_FIRST + i);
/** How /status says "I am the simulator bridge", so the panel never mistakes another server for it. */
export const BRIDGE_APP = 'stellar-sim-bridge';

/** Everything the setup installs lives here, outside the project, shared by all projects. */
export const HOME_DIR = join(homedir(), '.stellar', 'sim-bridge');

/** Pinned idb release: the companion binaries and the matching gRPC protocol. */
export const IDB_VERSION = '1.7.8';
export const IDB_RELEASE = `https://github.com/facebook/idb/releases/download/v${IDB_VERSION}`;
export const IDB_TARBALL = 'idb-companion.macos-arm64.tar.gz';
export const IDB_PROTO_URL = `https://raw.githubusercontent.com/facebook/idb/v${IDB_VERSION}/proto/idb.proto`;
export const IDB_DIR = join(HOME_DIR, `idb-${IDB_VERSION}`);
export const COMPANION_BIN = join(IDB_DIR, 'idb_companion');
export const SIM_VIDEO_BIN = join(IDB_DIR, 'sim-video');
export const PROTO_FILE = join(IDB_DIR, 'idb.proto');

/** npm packages for talking gRPC to the companion, installed into NODE_DIR. */
export const NODE_DIR = join(HOME_DIR, 'node');
export const NODE_PACKAGES = ['@grpc/grpc-js@1.14.7', '@grpc/proto-loader@0.8.1'];

export const STATE_FILE = join(HOME_DIR, 'state.json');
/** Holds the pid of the running bridge, so a second one doesn't start. */
export const LOCK_FILE = join(HOME_DIR, 'bridge.lock');
/**
 * The panel's own simulators live in a private device set: Simulator.app only watches the default set,
 * so it never opens a window for them, even when it is running.
 */
export const DEVICE_SET = join(HOME_DIR, 'devices');

/** Stop the video stream this long after the last viewer left. */
export const STREAM_IDLE_MS = 10_000;
export const STREAM_SCALE = 0.5;
export const STREAM_QUALITY = 0.7;
