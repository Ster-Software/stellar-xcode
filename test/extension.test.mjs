import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import i18n from '../i18n.js';

const DIR = path.resolve(import.meta.dirname, '..');

test('the Xcode extension: its manifest, icon, sidebar, simulator panel and texts', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
  assert.equal(`${manifest.publisher}.${manifest.name}`, 'ster-software.xcode');
  assert.deepEqual(manifest.panels.map((p) => p.id), ['simulator']);
  for (const file of ['icon.jsx', 'sidebar/index.jsx', 'panels/simulator/index.jsx', 'main.mjs', 'mcp.mjs']) {
    assert.ok(fs.existsSync(path.join(DIR, file)), file);
  }
  const used = new Set();
  const files = ['lib/xcode.mjs', 'sidebar/index.jsx', 'sidebar/Xcode.jsx', 'sidebar/Simulator.jsx',
    ...['index.jsx', 'SetupCheck.jsx', 'PlayOverlay.jsx', 'LiveScreen.jsx', 'PhoneFrame.jsx'].map((f) => `panels/simulator/${f}`)];
  for (const file of files) {
    for (const m of fs.readFileSync(path.join(DIR, file), 'utf8').matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
  }
  // Keys taken from a table (GROUPS, titleKey) too.
  for (const key of ['devices', 'simulators', 'generic', 'archiveTitle', 'sim.volumeUp', 'sim.volumeDown', 'sim.sideButton']) used.add(key);
  // The boot phases the panel shows (lib/sim/sim.mjs BOOT_PHASES).
  const { BOOT_PHASES } = await import('../lib/sim/sim.mjs');
  for (const phase of Object.keys(BOOT_PHASES)) used.add(`sim.phase.${phase}`);
  // Every text of the manifest ("%key%") too.
  for (const ref of JSON.stringify(manifest).matchAll(/%([\w.]+)%/g)) used.add(ref[1]);
  const has = (lang, key) => key.split('.').reduce((node, part) => node?.[part], i18n[lang]) !== undefined;
  for (const key of used) for (const lang of ['nl', 'en']) assert.ok(has(lang, key), `${lang}.${key} ontbreekt in i18n.js`);
  // Both languages have the same texts.
  const keys = (node, at = '') => Object.entries(node).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${at}${k}.`) : [`${at}${k}`])).sort();
  assert.deepEqual(keys(i18n.en), keys(i18n.nl));
});
