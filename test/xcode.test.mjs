import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, build } from '../lib/plist.mjs';
import { execFileSync } from 'node:child_process';
import './helpers/stellarShim.mjs';

const {
  findProjects, projectInfo, parseWorkspaceRefs, parseDestinations, destinationArg, archivePathFor, taskScript,
  listArchives, resolveArchive, uploadScript, parseTeams, teamArgs,
} = await import('../lib/xcode.mjs');

const mkdirs = (root, dirs) => dirs.forEach((d) => fs.mkdirSync(path.join(root, d), { recursive: true }));

test('finds projects and workspaces, preferring a workspace next to its project', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xc-'));
  assert.deepEqual(projectInfo(cwd), { exists: false, projects: [] });
  mkdirs(cwd, [
    'ios/App.xcodeproj', 'ios/App.xcworkspace', 'ios/Pods/Pods.xcodeproj',
    'node_modules/lib/ios/Lib.xcodeproj', 'apps/watch/Watch.xcodeproj', 'a/b/c/d/Deep.xcodeproj',
  ]);
  assert.deepEqual(findProjects(cwd), [
    { path: path.join('ios', 'App.xcworkspace'), kind: 'workspace', name: 'App' },
    { path: path.join('apps', 'watch', 'Watch.xcodeproj'), kind: 'project', name: 'Watch' },
  ]);
  assert.equal(projectInfo(cwd).exists, true);
});

test('workspace refs: project files only, without Pods', () => {
  const xml = `<Workspace version = "1.0">
    <FileRef location = "group:iMarry.xcodeproj"></FileRef>
    <FileRef location = "container:Sub/Other.xcodeproj"></FileRef>
    <FileRef location = "group:Pods/Pods.xcodeproj"></FileRef>
    <FileRef location = "self:"></FileRef>
    <FileRef location = "group:README.md"></FileRef>
  </Workspace>`;
  assert.deepEqual(parseWorkspaceRefs(xml), ['iMarry.xcodeproj', 'Sub/Other.xcodeproj']);
});

const SHOW_DESTINATIONS = `
	Available destinations for the "test" scheme:
		{ platform:macOS, arch:arm64, id:00006040-000C60800E8A801C, name:My Mac }
		{ platform:iOS, arch:arm64, id:00008140-000815112EA3001C, name:iPhone 16 Pro Max van Stefan }
		{ platform:iOS, id:dvtdevice-DVTiPhonePlaceholder-iphoneos:placeholder, name:Any iOS Device }
		{ platform:macOS, name:Any Mac }
		{ platform:macOS, arch:arm64, variant:Designed for [iPad,iPhone], id:00006040-000C60800E8A801C, name:My Mac }
		{ platform:iOS Simulator, arch:arm64, id:F45057E4-3420-400D-94CB-160290AE23C8, OS:26.5, name:iPhone 17 }

	Ineligible destinations for the "test" scheme:
		{ platform:visionOS, id:dvtdevice-DVTiOSDevicePlaceholder-xros:placeholder, name:Any visionOS Device, error:not installed }
`;

test('parses available destinations and skips ineligible or unaddressable ones', () => {
  const list = parseDestinations(SHOW_DESTINATIONS);
  assert.deepEqual(list.map((d) => [d.name, d.platform, d.generic]), [
    ['My Mac', 'macOS', false],
    ['iPhone 16 Pro Max van Stefan', 'iOS', false],
    ['Any iOS Device', 'iOS', true],
    ['Any Mac', 'macOS', true],
    ['iPhone 17', 'iOS Simulator', false],
  ]);
  assert.equal(list[4].os, '26.5');
  assert.equal(parseDestinations('xcodebuild: error: something else'), null);
});

test('destination arguments', () => {
  assert.equal(destinationArg({ platform: 'iOS Simulator', id: 'F45057E4-3420' }), 'platform=iOS Simulator,id=F45057E4-3420');
  assert.equal(destinationArg({ platform: 'iOS', generic: true }), 'generic/platform=iOS');
  assert.throws(() => destinationArg({ platform: 'iOS', id: 'x; rm -rf /' }));
  assert.throws(() => destinationArg({ platform: 'iOS"', generic: true }));
});

test('archives go where the Xcode Organizer looks', () => {
  const p = archivePathFor('iMarry', new Date(2026, 9, 4, 9, 5));
  assert.equal(p, path.join(os.homedir(), 'Library/Developer/Xcode/Archives/2026-10-04/iMarry 04-10-2026, 09.05.xcarchive'));
});

const BASE = { container: { kind: 'workspace', abs: '/p/ios/App.xcworkspace' }, scheme: "Bob's App", configuration: 'Debug' };

test('build/test/clean scripts quote everything and use the formatter when present', () => {
  const sim = { platform: 'iOS Simulator', id: 'ABC-1' };
  const script = taskScript({ ...BASE, action: 'build', destination: sim });
  assert.match(script, /-workspace '\/p\/ios\/App.xcworkspace' -scheme 'Bob'\\''s App' -configuration 'Debug' -destination 'platform=iOS Simulator,id=ABC-1' build/);
  assert.match(script, /xcbeautify/);
  assert.match(script, /pipefail/);
  assert.match(taskScript({ ...BASE, action: 'test', destination: sim }), / test &&/);
  // The closing line is the extension's text (the shim's i18n gives the key), safe inside printf's quotes.
  assert.match(taskScript({ ...BASE, action: 'test', destination: sim }), /printf '\\n\\033\[32m✓ task\.succeeded\\033\[0m\\n'$/);
  assert.throws(() => taskScript({ ...BASE, action: 'rm', destination: sim }));
  assert.throws(() => taskScript({ ...BASE, action: 'build', destination: undefined }), /bestemming/);
});

test('run script: install and launch per destination kind', () => {
  const app = { app: '/dd/App.app', bundleId: 'nl.x.app', executable: '/dd/App.app/Contents/MacOS/App' };
  const sim = taskScript({ ...BASE, action: 'run', destination: { platform: 'iOS Simulator', id: 'SIM-1' }, app });
  assert.match(sim, /simctl boot 'SIM-1'/);
  assert.match(sim, /simctl install 'SIM-1' '\/dd\/App.app'/);
  assert.match(sim, /simctl launch --console-pty --terminate-running-process 'SIM-1' 'nl.x.app'/);
  const device = taskScript({ ...BASE, action: 'run', destination: { platform: 'iOS', id: '0000-DEV' }, app });
  assert.match(device, /devicectl device install app --device '0000-DEV' '\/dd\/App.app'/);
  assert.match(device, /devicectl device process launch --console --terminate-existing --device '0000-DEV' 'nl.x.app'/);
  assert.match(device, /-allowProvisioningUpdates/);
  const mac = taskScript({ ...BASE, action: 'run', destination: { platform: 'macOS', id: 'MAC-1' }, app });
  assert.match(mac, /'\/dd\/App.app\/Contents\/MacOS\/App'$/);
  assert.throws(() => taskScript({ ...BASE, action: 'run', destination: { platform: 'iOS', generic: true }, app }));
});

test('archive script builds for the generic device and opens the Organizer', () => {
  const script = taskScript({ ...BASE, action: 'archive', destination: { platform: 'iOS Simulator', id: 'SIM-1' }, archivePath: '/a/X.xcarchive' });
  assert.match(script, /-destination 'generic\/platform=iOS' -archivePath '\/a\/X.xcarchive' -allowProvisioningUpdates archive/);
  assert.match(script, /open '\/a\/X.xcarchive'/);
});

test('teams from the Xcode accounts, once per team and sorted by name', () => {
  const prefs = { IDEProvisioningTeamByIdentifier: {
    'ACC-1': [
      { teamID: '2GP6U8JHHQ', teamName: 'Ster Software B.V.', teamType: 'Company', isFreeProvisioningTeam: false },
      { teamID: '79T38YQSTP', teamName: 'Stefan (Personal Team)', teamType: 'Personal Team', isFreeProvisioningTeam: true },
    ],
    'ACC-2': [{ teamID: '2GP6U8JHHQ', teamName: 'Ster Software B.V.' }, { teamID: 'bad id', teamName: 'X' }],
  } };
  assert.deepEqual(parseTeams(prefs), [
    { id: '79T38YQSTP', name: 'Stefan (Personal Team)', personal: true },
    { id: '2GP6U8JHHQ', name: 'Ster Software B.V.', personal: false },
  ]);
  assert.deepEqual(parseTeams({}), []);
});

test('a chosen team overrides DEVELOPMENT_TEAM; none keeps the project setting', () => {
  const sim = { platform: 'iOS Simulator', id: 'ABC-1' };
  assert.deepEqual(teamArgs(null), []);
  assert.deepEqual(teamArgs('2GP6U8JHHQ'), ['DEVELOPMENT_TEAM=2GP6U8JHHQ']);
  assert.throws(() => teamArgs('X; rm -rf /'), /team/i);
  assert.match(taskScript({ ...BASE, action: 'build', destination: sim, team: '2GP6U8JHHQ' }), / DEVELOPMENT_TEAM=2GP6U8JHHQ build &&/);
  assert.match(taskScript({ ...BASE, action: 'archive', destination: sim, archivePath: '/a/X.xcarchive', team: '2GP6U8JHHQ' }),
    /-allowProvisioningUpdates DEVELOPMENT_TEAM=2GP6U8JHHQ archive/);
  assert.doesNotMatch(taskScript({ ...BASE, action: 'build', destination: sim }), /DEVELOPMENT_TEAM/);
});

// plutil (binary plists) only exists on macOS, like Xcode itself.
test('lists archive metadata for the chosen scheme, newest first, including binary plists', { skip: process.platform !== 'darwin' && 'macOS only' }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xc-archives-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const makeArchive = (day, name, scheme, date, app = true) => {
    const dir = path.join(root, day, `${name}.xcarchive`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Info.plist'), build({ Name: name, SchemeName: scheme,
      CreationDate: new Date(date), ...(app ? { ApplicationProperties: { ApplicationPath: `Applications/${name}.app`,
        CFBundleIdentifier: 'nl.test.app', CFBundleShortVersionString: '2.0', CFBundleVersion: '42' } } : {}) }));
    return dir;
  };
  const old = makeArchive('2026-10-01', 'Old', 'App', '2026-10-01T12:00:00Z');
  const newest = makeArchive('2026-10-02', 'Newest', 'App', '2026-10-02T12:00:00Z');
  execFileSync('/usr/bin/plutil', ['-convert', 'binary1', path.join(newest, 'Info.plist')]);
  makeArchive('2026-10-02', 'Other', 'Other', '2026-10-02T13:00:00Z');
  const noApp = makeArchive('2026-10-02', 'Library', 'Library', '2026-10-02T14:00:00Z', false);
  fs.mkdirSync(path.join(root, '2026-10-02', 'Incomplete.xcarchive'));
  const archives = await listArchives('App', root);
  assert.deepEqual(archives.map((a) => a.path), [newest, old]);
  assert.equal(archives[0].created, '2026-10-02T12:00:00.000Z');
  assert.equal(archives[0].version, '2.0');
  assert.equal(archives[0].build, '42');
  assert.equal((await resolveArchive(newest, root)).uploadable, true);
  assert.deepEqual(await listArchives('Missing', root), []);
  assert.deepEqual(await listArchives('App', path.join(root, 'missing')), []);
  await assert.rejects(resolveArchive(noApp, root), /geen app|noUploadableApp/);
  await assert.rejects(resolveArchive(root, root), /Onbekend/);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'external-archive-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.symlinkSync(external, path.join(root, 'External.xcarchive'));
  await assert.rejects(resolveArchive(path.join(root, 'External.xcarchive'), root), /Onbekend/);
});

// The script runs in zsh, which macOS has and Windows doesn't.
test('upload command quotes archive paths, preserves the build number and cleans temporary files', { skip: !fs.existsSync('/bin/zsh') && 'no /bin/zsh' }, () => {
  const script = uploadScript("/Archives/Bob's $(touch unsafe).xcarchive");
  execFileSync('/bin/zsh', ['-n'], { input: script });
  assert.match(script, /-archivePath '\/Archives\/Bob'\\''s \$\(touch unsafe\)\.xcarchive'/);
  const options = script.slice(script.indexOf('<?xml'), script.indexOf('</plist>') + '</plist>'.length);
  const parsed = parse(options);
  assert.equal(parsed.method, 'app-store-connect');
  assert.equal(parsed.destination, 'upload');
  assert.equal(parsed.signingStyle, 'automatic');
  assert.equal(parsed.manageAppVersionAndBuildNumber, false);
  assert.match(script, /-allowProvisioningUpdates/);
  assert.match(script, /trap 'rm -rf "\$xc_upload_dir"' EXIT/);
  assert.ok(script.startsWith('set -e\n'));
});
