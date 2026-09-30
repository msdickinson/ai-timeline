#!/usr/bin/env node
/**
 * Copy PWA assets (manifest + service worker) from public/ into the
 * Vite build output. Replaces a Unix-only `cp` invocation in the build
 * script so `npm run build` works on Windows / macOS / Linux without a
 * shell shim.
 *
 * Vite's `outDir` is `../../dist/web/` relative to `src/web/`, so the
 * absolute path resolves to `<repo>/dist/web/`.
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(root, 'dist', 'web'); // ../../dist/web/ from src/web/ → <repo>/dist/web/

mkdirSync(out, { recursive: true });

const files = ['manifest.json', 'sw.js'];
for (const f of files) {
  copyFileSync(join(root, 'public', f), join(out, f));
  console.log(`copied public/${f} → dist/web/${f}`);
}
