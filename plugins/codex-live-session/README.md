# Codex Live Session

Session-scoped bridge prototype for controlling one live Codex conversation from
a phone.

This is the first implementation slice for the clean mobile session control
requirement. It deliberately avoids historical session import, background agent
lists, and long-lived archives.

## What Works In This MVP

- Connects to Codex app-server by spawning a bridge-owned app-server by default.
- Keeps `codex app-server proxy` support for environments that expose an
  app-server control socket.
- Binds to a single explicit `threadId`, or auto-binds only when exactly one
  loaded thread is visible.
- Serves a phone-friendly web page over HTTP.
- Streams live session events to the phone page with Server-Sent Events.
- Accepts phone-originated text input through `POST /input`.
- Sends phone input to Codex with `turn/start` when the bound thread is idle.
- For current Codex Desktop windows, can inject through Desktop IPC so the PC
  UI shows the phone-triggered turn.
- Queues phone input while a turn is active by default.
- Clears all runtime state when the bridge process exits.

## Start

Prefer passing an explicit thread id:

```bash
node plugins/codex-live-session/scripts/bridge.mjs --thread-id <thread-id>
```

For a phone on the same network:

```bash
node plugins/codex-live-session/scripts/bridge.mjs \
  --thread-id <thread-id> \
  --host 0.0.0.0 \
  --public-url http://<pc-lan-ip>:8765
```

If there is exactly one loaded thread, the bridge can bind automatically:

```bash
node plugins/codex-live-session/scripts/bridge.mjs --auto-bind
```

The bridge prints a URL containing a temporary token. Open that URL on the phone.

Same-network URLs are only for development. For the actual away-from-PC use
case, run the bridge behind a public tunnel or relay and pass the public URL with
`--public-url`.

Cloudflare Tunnel example:

```bash
node plugins/codex-live-session/scripts/start-cloudflare-tunnel.mjs
```

The script automatically starts the local bridge, starts `cloudflared`, parses
the temporary public HTTPS URL, and appends the pairing token.

Manual Cloudflare Tunnel command shape:

```bash
cloudflared tunnel --url http://127.0.0.1:8765
```

Then start the bridge with the public HTTPS URL printed by Cloudflare:

```bash
node plugins/codex-live-session/scripts/bridge.mjs \
  --rollout-file ~/.codex/sessions/<date>/rollout-<session>.jsonl \
  --thread-id <session-id> \
  --injector desktop-ipc \
  --host 127.0.0.1 \
  --public-url https://<cloudflare-tunnel-host>
```

## Current Codex Desktop Session Test

When Codex Desktop does not expose an app-server control socket, use rollout
tailing plus the Desktop IPC injector for a current-session test:

```bash
node plugins/codex-live-session/scripts/bridge.mjs \
  --rollout-file ~/.codex/sessions/<date>/rollout-<session>.jsonl \
  --thread-id <session-id> \
  --injector desktop-ipc \
  --host 0.0.0.0 \
  --public-url http://<pc-lan-ip>:8765
```

This mode streams new rollout events from the current Codex Desktop conversation
and sends phone-originated text back through Codex Desktop's local IPC router.
The phone-triggered turn is started by the Desktop window that owns the bound
conversation, so the PC UI should show the same reply process.

The older `debug` and `ui` injectors remain as fallbacks for investigation, but
they are not the preferred current-window path. `debug` can create a separate
session, and `ui` depends on macOS Accessibility permission.

When Codex exposes an app-server control socket, use proxy mode:

```bash
node plugins/codex-live-session/scripts/bridge.mjs \
  --mode proxy \
  --sock /path/to/app-server-control.sock \
  --thread-id <thread-id>
```

## Input Policy

Default active-turn policy is `queue`.

```bash
node plugins/codex-live-session/scripts/bridge.mjs \
  --thread-id <thread-id> \
  --active-policy queue
```

`steer` is available for protocol validation, but the first product version
should keep `queue` as the default until active-turn behavior is verified across
real Codex Desktop sessions.

## API

- `GET /` renders the phone page.
- `GET /events?token=...` opens the live event stream.
- `POST /input?token=...` accepts `{ "text": "..." }`.
- `GET /health?token=...` returns bridge status.

## Notes

This prototype is intentionally local and session-scoped. It is the adapter that
can later be wired into a native mobile client and relay, but it already gives a
usable phone browser surface for testing the end-to-end control flow.
