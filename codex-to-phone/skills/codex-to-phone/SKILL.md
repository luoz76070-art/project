---
name: codex-to-phone
description: Start, stop, or check Codex To Phone, a session-scoped bridge that exposes the current Codex Desktop conversation to a phone via QR URL. Use when the user says "启动 Codex To Phone", "启动手机同步", "手机同步当前会话", "查看 Codex To Phone 状态", or "停止 Codex To Phone".
---

# Codex To Phone

Use this skill to manage the Codex To Phone bridge from inside Codex.

## What It Does

- Starts a local bridge for the currently active Codex Desktop conversation.
- Starts a Cloudflare Quick Tunnel.
- Prints a phone URL and QR code.
- Lets the phone view summarized progress and send text back into the owning Codex Desktop window.

## Commands

First resolve the plugin root from this skill file:

```bash
PLUGIN_ROOT="<path-to-this-skill>/../.."
```

In this repository checkout, that is the `codex-to-phone` directory.

### Start

Run:

```bash
cd "$PLUGIN_ROOT"
npm install
npm run plugin:start
```

Then report:

- the printed phone URL;
- that the QR code was printed in the command output;
- that the user should keep the target Codex Desktop conversation window open.

### Status

Run:

```bash
cd "$PLUGIN_ROOT"
npm run plugin:status
```

Report whether the bridge is running, the phone URL if available, and the bound thread id if the health check returns it.

### Stop

Run:

```bash
cd "$PLUGIN_ROOT"
npm run plugin:stop
```

Report that the current pairing URL is invalidated once the bridge is stopped.

## Troubleshooting

- If `cloudflared` is missing, tell the user to install it with `brew install cloudflared`.
- If no phone URL appears after startup, run `npm run plugin:status` and inspect `~/.codex-to-phone/service.log`.
- If phone input fails with `no-client-found`, ask the user to open the matching Codex Desktop conversation window and retry.
- If the phone page opens but updates are delayed, the UI still polls in the background; wait a few seconds or reload the phone page.

## Scope

This is currently a single-session bridge. Multi-session binding is a planned extension, not part of the current plugin workflow.
