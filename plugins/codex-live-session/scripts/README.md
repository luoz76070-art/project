# Scripts

- `bridge.mjs` starts the session-scoped bridge and serves the phone web page.
- `start-cloudflare-tunnel.mjs` starts the current-session bridge and exposes it
  through a temporary Cloudflare Tunnel URL.

Run syntax checks with:

```bash
node --check plugins/codex-live-session/scripts/bridge.mjs
node --check plugins/codex-live-session/scripts/start-cloudflare-tunnel.mjs
```
