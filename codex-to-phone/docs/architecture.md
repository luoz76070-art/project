# Architecture

## Goal

Codex To Phone is session-scoped remote control for a live Codex Desktop conversation.

The bridge starts when the user wants to expose one current session to the phone. It should not create a long-lived archive or show unrelated historical sessions.

## Plugin Shape

`codex-to-phone/` is both a runnable Node package and a Codex local plugin.

- `.codex-plugin/plugin.json` declares the plugin metadata.
- `skills/codex-to-phone/SKILL.md` gives Codex the natural-language workflow for start, stop, status, and troubleshooting.
- `scripts/service.mjs` manages the bridge as a background service for the skill entry.
- `scripts/start-cloudflare-tunnel.mjs` starts the local bridge and public tunnel.
- `scripts/bridge.mjs` owns the phone UI, rollout tailing, and the current phone-to-PC injector.

## Runtime Flow

```text
Codex Skill command
        |
        v
service.mjs background manager
        |
        v
Codex Desktop rollout JSONL
        |
        v
PC bridge on 127.0.0.1
        |
        +-- codex://threads/<id> + visible UI injector -> Codex Desktop window
        |
        v
Cloudflare Quick Tunnel
        |
        v
Phone web UI
```

## PC To Phone

- `bridge.mjs` tails the bound rollout JSONL file.
- Rollout records are normalized into high-level events.
- The phone page receives events through `GET /events` and `GET /poll`.
- The phone UI filters the event stream:
  - user input is shown as a user card;
  - assistant messages are shown as Codex cards;
  - tool calls are shown as compact tool cards;
  - patch content and command output are hidden by default;
  - bridge internal states are not displayed unless they are failures.
- Startup backfill is limited to the previous completed turn. Active and future turns are streamed from the rollout tail after pairing.

## Phone To PC

- The phone sends text to `POST /input`.
- The pairing URL contains both `token` and `session=<conversationId>`. The bridge rejects every phone API request unless both values match the startup binding.
- The default injector opens `codex://threads/<conversationId>`, waits for Codex Desktop to focus that conversation, then pastes and submits the phone text through the visible input box.
- This path avoids Codex Desktop IPC owner discovery, which is unstable when the current renderer does not expose the thread as an owner.
- Desktop IPC remains available as an explicit experimental mode with `--injector desktop-ipc`.
- The bridge verifies that the phone message appears in the bound rollout before reporting success.

## Why Not Use The Bridge-Owned App Server For The Current UI

A bridge-owned `codex app-server` can resume the same thread id and generate a valid reply, but the existing Codex Desktop window is not subscribed to that runtime. The phone can see the reply, and the rollout can be written, but the PC UI will not show the live reply process.

The current default uses visible UI injection for the current-window path because it makes the Desktop window itself submit the message. Desktop IPC remains a better long-term product path if the owner registration problem can be solved reliably.

## Future Multi-Session Design

The next step is to manage multiple session bindings:

- one bridge process can expose multiple `conversationId` entries;
- each phone command includes a target `conversationId`;
- the phone UI shows a session switcher;
- each session has independent queue, token, status, and last-event cursor;
- Desktop control routing continues to require either a focused visible window or a reliable Desktop owner for each conversation.
