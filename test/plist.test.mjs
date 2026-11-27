import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, parse } from '../lib/plist.mjs';

test('plist: an archive\'s Info.plist (dates, nested dicts, arrays, escapes)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ApplicationProperties</key>
	<dict>
		<key>CFBundleIdentifier</key>
		<string>com.example.app</string>
		<key>CFBundleShortVersionString</key>
		<string>1.2</string>
		<key>Architectures</key>
		<array><string>arm64</string></array>
	</dict>
	<key>CreationDate</key>
	<date>2026-11-26T10:00:00Z</date>
	<key>Name</key>
	<string>A &amp; B &lt;app&gt;</string>
	<key>Version</key>
	<integer>2</integer>
	<key>Free</key>
	<true/>
	<key>Empty</key>
	<array/>
	<key>Blob</key>
	<data>
	AAEC
	</data>
</dict>
</plist>`;
  assert.deepEqual(parse(xml), {
    ApplicationProperties: { CFBundleIdentifier: 'com.example.app', CFBundleShortVersionString: '1.2', Architectures: ['arm64'] },
    CreationDate: '2026-11-26T10:00:00.000Z', Name: 'A & B <app>', Version: 2, Free: true, Empty: [], Blob: 'AAEC',
  });
  assert.throws(() => parse(''), /leeg/);
  assert.throws(() => parse('<plist><dict><string>x</string></dict></plist>'), /key/);
});

test('plist: build writes what plutil (and parse) read back', () => {
  const value = { method: 'app-store-connect', destination: 'upload', manageAppVersionAndBuildNumber: false, uploadSymbols: true, n: 3, list: ['a & b'] };
  const xml = build(value);
  assert.deepEqual(parse(xml), value);
  if (process.platform === 'darwin') {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plist-')), 'x.plist');
    fs.writeFileSync(file, xml);
    assert.doesNotThrow(() => execFileSync('/usr/bin/plutil', ['-lint', file]));
  }
});

test('plist: a Date is written as <date> and read back as its ISO time', () => {
  assert.deepEqual(parse(build({ at: new Date('2026-10-02T12:00:00Z') })), { at: '2026-10-02T12:00:00.000Z' });
});
