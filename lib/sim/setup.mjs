// The setup wizard's work: check Xcode, download idb-companion (checksum verified) and the gRPC packages.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  COMPANION_BIN, HOME_DIR, IDB_DIR, IDB_PROTO_URL, IDB_RELEASE, IDB_TARBALL, NODE_DIR, NODE_PACKAGES, PROTO_FILE, SIM_VIDEO_BIN,
} from './config.mjs';
import { run } from './exec.mjs';

/** Progress of a running setup, read by GET /status. */
let progress = { running: false, step: null, error: null };

export const setupProgress = () => progress;

const grpcInstalled = () => existsSync(join(NODE_DIR, 'node_modules', '@grpc', 'grpc-js', 'package.json'))
  && existsSync(join(NODE_DIR, 'node_modules', '@grpc', 'proto-loader', 'package.json'));

async function xcodeReady() {
  try {
    await run('xcrun', ['simctl', 'help'], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** What is there and what is missing; the panel shows a step per item. */
export async function setupChecks() {
  return {
    platform: process.platform === 'darwin' && process.arch === 'arm64',
    xcode: await xcodeReady(),
    companion: existsSync(COMPANION_BIN) && existsSync(SIM_VIDEO_BIN) && existsSync(PROTO_FILE),
    grpc: grpcInstalled(),
  };
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download mislukt (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function installCompanion() {
  progress = { ...progress, step: 'idb-companion downloaden' };
  const [tarball, checksumFile] = await Promise.all([
    download(`${IDB_RELEASE}/${IDB_TARBALL}`),
    download(`${IDB_RELEASE}/${IDB_TARBALL}.sha256`),
  ]);
  const expected = checksumFile.toString('utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(tarball).digest('hex');
  if (expected !== actual) throw new Error(`Checksum klopt niet voor ${IDB_TARBALL} (verwacht ${expected}, kreeg ${actual}).`);

  progress = { ...progress, step: 'idb-companion uitpakken' };
  await rm(IDB_DIR, { recursive: true, force: true });
  await mkdir(IDB_DIR, { recursive: true });
  const tarPath = join(HOME_DIR, IDB_TARBALL);
  await writeFile(tarPath, tarball);
  await run('tar', ['-xzf', tarPath, '-C', IDB_DIR]);
  await rm(tarPath, { force: true });
  // Downloaded with fetch, so normally not quarantined; clear it anyway so Gatekeeper doesn't block the binaries.
  await run('xattr', ['-dr', 'com.apple.quarantine', IDB_DIR]).catch(() => {});

  progress = { ...progress, step: 'gRPC-protocol downloaden' };
  await writeFile(PROTO_FILE, await download(IDB_PROTO_URL));
  await run(COMPANION_BIN, ['--version'], { timeout: 30_000 });
}

async function installGrpc() {
  progress = { ...progress, step: 'gRPC-pakketten installeren' };
  await mkdir(NODE_DIR, { recursive: true });
  const manifest = join(NODE_DIR, 'package.json');
  if (!existsSync(manifest)) await writeFile(manifest, JSON.stringify({ private: true }, null, 2));
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...NODE_PACKAGES], { cwd: NODE_DIR, timeout: 300_000 });
}

/** Installs whatever is missing. Resolves when done; errors end up in setupProgress(). */
export async function runSetup() {
  if (progress.running) return;
  progress = { running: true, step: 'controleren', error: null };
  try {
    await mkdir(HOME_DIR, { recursive: true });
    const checks = await setupChecks();
    if (!checks.platform) throw new Error('Dit werkt alleen op een Mac met Apple silicon.');
    if (!checks.xcode) throw new Error('Xcode ontbreekt of is niet gekozen. Installeer Xcode en draai: sudo xcode-select -s /Applications/Xcode.app');
    if (!checks.companion) await installCompanion();
    if (!checks.grpc) await installGrpc();
    progress = { running: false, step: null, error: null };
  } catch (error) {
    console.error('[setup]', error);
    progress = { running: false, step: null, error: error.message };
  }
}
