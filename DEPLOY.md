# Deploy AI Timeline

AI Timeline is a static single-page app — no server, no database. You
build once and serve the `dist/web/` directory from any HTTP server.
No data leaves the user's browser; the app reads session files from
the local filesystem via the File System Access API.

## Build

```bash
npm install
npm run build
```

Output lands in `dist/web/`: `index.html`, hashed JS chunks,
`manifest.json`, and `sw.js`. It is self-contained. Zip it, ship it.

## Host options

### Static host (simplest)

Anything that serves files works: GitHub Pages, Cloudflare Pages,
Netlify, Vercel static, S3 + CloudFront, nginx, Caddy, `python -m
http.server`. **Two requirements:**

- **HTTPS in production.** The File System Access API and Service
  Worker registration both require a secure context. Local
  development on `http://localhost` is exempt.
- **Correct MIME for `manifest.json`.** Should be served as
  `application/manifest+json` for the PWA install hint to work, but
  most hosts serve it as `application/json` and it still functions —
  just no install button on some browsers.

Example with Caddy:

```
ai-timeline.example.com {
    root * /var/www/ai-timeline
    encode gzip zstd
    file_server
    @manifest path /manifest.json
    header @manifest Content-Type application/manifest+json
}
```


## Browser requirements

| Feature | Chrome / Edge | Firefox | Safari |
|---------|---------------|---------|--------|
| Drop session files | ✅ | ✅ | ✅ |
| **Pick a folder of sessions** | ✅ | ❌ no FS Access API | ❌ no FS Access API |
| Live tail (Claude Code, VETT) | ✅ | ❌ | ❌ |
| PWA install | ✅ | ⚠️ partial | ⚠️ partial |

Firefox / Safari users can still use the app, but they'll have to
drop files manually (or pick individual files via `<input type=file>`)
instead of opening a whole folder. The app detects this and routes to
the file-picker fallback. If you can require Chromium for your
audience, recommend it.

## Service worker behavior

`public/sw.js` does network-first caching for same-origin GETs only.
It deliberately:

- Skips cross-origin requests (so live VETT SSE on `localhost:5151`
  works without interference)
- Skips `text/event-stream` responses (cloning a streaming body
  deadlocks)
- Falls back to cache only when the network fails

To roll out a new version, increment `CACHE_NAME` in `sw.js`. On the
next page load the old cache is dropped and fresh assets are fetched.
Without bumping `CACHE_NAME`, returning users may see stale JS for one
load until the SW's network-first fetch wins. For a hard cutover, add
a banner asking them to hard-reload.

## Storage

The app writes to two storage backends in the browser:

| Storage | Used for | Approx. size |
|---------|----------|--------------|
| `localStorage` | UI prefs (theme, settings, last view) | <100 KB |
| **IndexedDB** `ai-timeline-cache` | Parsed trajectory cache, keyed by `(filename, size, mtime)` | depends on data — bump cache version in `app.ts` to invalidate |

Nothing leaves the user's browser. There is no analytics, no
telemetry, no remote config.

## Updates

`package.json` and `vscode-package.json` carry version numbers.
Bump both when cutting a release:

```bash
# Tag the release
git tag v0.2.0
git push --tags

# Build + ship the web bundle
npm run build
# then upload dist/web/ to your static host

# Build + publish the VS Code extension
npm run build:ext
npx vsce package           # produces ai-timeline-0.2.0.vsix
npx vsce publish           # marketplace; requires a publisher access token
```

## Troubleshooting

**Blank page after deploy.** Check the browser console — usually a
stale service worker serving an outdated `index.html` that references
chunks that no longer exist. Fix: bump `CACHE_NAME` in `sw.js`,
redeploy. Users hard-reload (`Ctrl+Shift+R`).

**Folder picker shows nothing.** User is on Firefox/Safari. The picker
falls back to a multi-select file input but can't recurse. Tell them
to either pick individual `.jsonl` files or switch to a Chromium
browser.

**Live tail can't connect.** The browser blocks mixed content: HTTPS
page calling `http://localhost:5151/events` will fail silently. Two
fixes: serve AI Timeline on plain HTTP for internal use, or terminate
TLS on the live source too (the VETT live server doesn't do TLS, so
this means a reverse proxy in front of it).
