// The sidebar and panels use stellar/ui and Tailwind only: none of Stellar's old app class names (npm-head, py-card,
// xc-tip, side-empty, …), which only a compatibility layer in Stellar still translates for older versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '..');
const OLD = /(?:^|[\s"'`])(npm-[\w-]+|py-(?:view|head|card|status|actions|missing|interp)[\w-]*|xc-[\w-]+|godot-[\w-]+|clone-[\w-]+|side-(?:empty|select)|dialog-search|row-actions?|btn)(?=$|[\s"'`])/;

function jsxFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['test', 'node_modules', '.git'].includes(entry.name) ? [] : jsxFiles(full);
    return entry.name.endsWith('.jsx') ? [full] : [];
  });
}

test('no old Stellar class names in the JSX', () => {
  for (const file of jsxFiles(DIR)) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const hit = (m[1] ?? m[2]).match(OLD);
      assert.equal(hit, null, `${path.relative(DIR, file)}: ${hit?.[1]}`);
    }
  }
});
