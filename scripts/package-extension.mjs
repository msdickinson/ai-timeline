#!/usr/bin/env node
/**
 * Package the VS Code extension into a .vsix.
 *
 * vsce reads `package.json`, but our web app uses package.json for its
 * own (different) manifest. The extension manifest lives in
 * vscode-package.json. This script swaps them, runs vsce, and swaps back —
 * so neither manifest gets mutated permanently.
 */

import { execSync } from 'node:child_process';
import { copyFileSync, renameSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const webManifest = join(root, 'package.json');
const webBackup = join(root, 'package.json.web.bak');
const extManifest = join(root, 'vscode-package.json');

// Read the extension version so we can name the output file consistently.
const ext = JSON.parse(readFileSync(extManifest, 'utf8'));
const out = join(root, `ai-timeline-${ext.version}.vsix`);

console.log(`Packaging ai-timeline ${ext.version} → ${out}`);

renameSync(webManifest, webBackup);
try {
  copyFileSync(extManifest, webManifest);
  execSync(`npx vsce package --no-dependencies --out "${out}"`, {
    cwd: root,
    stdio: 'inherit',
  });
} finally {
  renameSync(webBackup, webManifest);
}

console.log(`\nDone: ${out}`);
