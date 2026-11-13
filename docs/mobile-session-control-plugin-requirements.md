# Mobile Session Control Plugin Requirements

## Purpose

Build a clean session-scoped plugin for Codex Desktop that lets the user connect
a phone app to the currently active Codex conversation, monitor progress in real
time, and send instructions back from the phone.

This document is the new source of truth for the requirement. It does not inherit
old project documents, old daemon behavior, old import behavior, or any failed
previous implementation assumptions.

## Product Goal

When the plugin is started inside one Codex conversation:

1. The plugin binds only to that current conversation.
2. The phone app connects to that plugin instance from any network where the
   user has internet access.
3. The phone shows live progress from the Codex conversation.
4. The phone can send new user instructions back into the same Codex
   conversation.
5. The plugin stops syncing and clears temporary state when the user closes it.

## Session Scope

The plugin is scoped to one explicit running session.

Required behavior:

- The plugin starts only after the user explicitly launches it in a conversation
  window.
- The phone loads only the current session associated with that launch.
- The phone receives content only from plugin start until plugin shutdown.
- The plugin must not load old conversations by default.
- The plugin must not save a reusable historical session archive.
- Restarting the plugin starts a fresh runtime scope unless the user later adds
  an explicit history feature.

## PC To Phone Requirements

The PC-to-phone direction is accepted as a required capability.

The phone should receive real-time updates for the active Codex conversation,
including:

- User messages created after plugin startup.
- Assistant progress and final responses.
- Tool calls and tool results.
- Command progress when Codex is running commands.
- Status changes such as running, waiting, completed, failed, or stopped.

The initial implementation can focus on text/status synchronization. Rich
attachments, images, and detailed file previews can be added later.

## Phone To PC Requirements

The phone-to-PC direction is a core requirement.

The phone app must be able to control Codex by sending a message that becomes
user input in the active PC-side Codex conversation.

Required behavior:

- The phone sends a text instruction to the plugin.
- The plugin injects that instruction into the currently bound Codex input flow.
- Codex treats the injected instruction as a normal user message in the current
  session.
- The resulting Codex progress streams back to the phone.
- If Codex is already running, the system must handle the phone message
  predictably, either by steering the active turn, queuing it, or asking the user
  to choose an interrupt behavior.

User motivation:

- The user wants to leave the computer while still monitoring and controlling
  Codex.
- The phone app should act as a remote control for the current Codex execution,
  not as a separate historical chat viewer.

## Lifecycle Requirements

### Start

- User launches the plugin inside a Codex conversation.
- The plugin creates a fresh temporary connection identity.
- The phone connects to that identity, for example through QR code or app deep
  link. The connection must not require the phone to be on the same local
  network as the PC.
- Sync begins from the launch point.

### Run

- PC-side events stream to the phone.
- Phone-originated text messages can be submitted to the active Codex session.
- The plugin keeps enough temporary runtime state to support live sync,
  acknowledgements, and reconnection.
- The PC side maintains an outbound connection to a relay or tunnel, so it can
  remain reachable when the user leaves the PC network.

### Stop

- User closes the plugin or the bound Codex session ends.
- Phone connection is invalidated.
- Temporary pairing state and runtime buffers are cleared.
- No historical conversation archive is retained by default.

## Safety Requirements

- The phone must not receive raw local credentials, tokens, shell access, or
  unrestricted local APIs.
- The public endpoint must not expose the local bridge without a short-lived
  pairing token.
- Relay/tunnel servers must not persist session timeline content by default.
- Phone-originated instructions must target only the bound current conversation.
- The plugin must reject input if it cannot prove the target session.
- Existing Codex approval, sandbox, and tool-permission behavior must remain in
  force.
- The system must avoid silently injecting phone messages into the wrong
  conversation or another desktop application.

## Non-Goals

- No always-on background daemon as the default product model.
- No automatic import of old sessions.
- No automatic replay of historical conversations.
- No multi-session dashboard in the first version.
- No multi-phone control in the first version.
- No remote bypass of Codex approvals or safety checks.

## Open Questions

- How should the plugin obtain the current Codex conversation identity in the
  most reliable way?
- Which remote connectivity mode should be the default: hosted relay,
  Cloudflare Tunnel, user-owned relay, or a mix?
- Should remote approval from the phone be supported later, or should approvals
  remain PC-only?
- What minimum reconnect window should the phone support after temporary network
  loss?

## Implementation Decisions

- The first implementation slice lives in `plugins/codex-live-session`.
- The first phone surface is a local mobile web page served by the PC bridge.
  This keeps the end-to-end control loop testable before building or modifying a
  native mobile app.
- The bridge currently defaults to a bridge-owned `codex app-server` process for
  protocol validation and phone-web testing. It also supports `codex app-server
  proxy` when a Codex app-server control socket is available.
- For current Codex Desktop session testing when no app-server control socket is
  exposed, the bridge can tail the active rollout JSONL file and use Codex
  Desktop's local IPC router as the phone-to-PC injector.
- Local-network-only access is not sufficient for the product goal. It is only a
  development fallback. The production path must use a public relay or tunnel
  established from an outbound PC connection.
- The first version binds to an explicit `threadId`, or auto-binds only when
  exactly one loaded thread is visible. It must not guess from recent history.
- During an active Codex run, phone input defaults to queue. Steering an active
  turn remains available as an explicit experimental policy, but is not the
  default.
- The phone web surface must not rely on a single streaming transport. In the
  Cloudflare Tunnel MVP, SSE can connect but fail to deliver buffered events, so
  the web surface uses polling as a fallback and deduplicates events by bridge
  sequence id.
- For current-session testing, bridge startup backfills the previous completed
  Codex turn plus any currently active turn. This gives the phone enough context
  without importing the full historical conversation by default.
- Phone-originated input must show separate states for accepted, queued,
  sending, sent, and failed. A transport-level success is not enough; the bridge
  must verify that the phone message reached the bound Desktop session.
- `codex debug app-server send-message-v2` is not reliable as the current
  Desktop-session injector because it can create a separate Codex session. The
  MVP therefore treats debug injection as experimental and validates the target
  rollout before reporting success.
- The preferred current-window phone-to-PC path is now Desktop IPC injection:
  the bridge registers as an IPC client, sends `thread-follower-start-turn` for
  the bound `conversationId`, and lets the owning Codex Desktop window start the
  turn. This is the path that should make the PC UI show the phone-triggered
  reply process.
- Bridge-owned Codex app-server injection remains useful for protocol
  validation and phone-only tests, but it does not make the current Desktop UI
  stream the generated turn because the UI is not subscribed to that separate
  app-server runtime.
- The temporary current-window injector can use macOS UI automation to paste
  into the active Codex Desktop window. This is now only a fallback because
  macOS Accessibility/TCC can get stuck or identify the wrong helper app.
- The macOS UI injector requires Accessibility permission. If macOS blocks
  simulated keystrokes, the phone must show an actionable failure message rather
  than a generic `phone.input.failed` state.
- Remote approval is not supported in the first version. Existing Codex approval
  and sandbox behavior remain the safety boundary.

## Acceptance Criteria

- Starting the plugin from a Codex conversation produces a fresh phone pairing
  entry for only that conversation.
- The phone sees new PC-side Codex progress within a few seconds.
- A phone-originated text instruction appears in the active PC-side Codex
  conversation as user input.
- The response triggered by that phone instruction streams back to the phone.
- Closing the plugin disconnects the phone and invalidates the runtime pairing.
- Reopening the plugin does not show prior session history unless a future
  explicit history feature is added.

## Requirement Log

- 2026-05-12: Created clean requirements document after removing old documents
  from the current project.
- 2026-05-12: Added requirement that the plugin is session-scoped, launchable
  from one conversation window, paired with a phone app, synchronized only from
  startup to shutdown, and non-persistent by default.
- 2026-05-12: Added requirement that phone-to-PC control must inject phone
  messages into the active Codex input flow so the user can control Codex while
  away from the computer.
- 2026-05-12: Added first implementation slice under
  `plugins/codex-live-session` with a local bridge, phone web page, SSE event
  stream, and phone-to-PC text submission endpoint.
- 2026-05-12: Added current-session test mode using rollout tailing. It first
  used the Codex debug message injector, which later proved unreliable for the
  bound Desktop window.
- 2026-05-12: Clarified that same-network access is insufficient for the target
  use case and that production connectivity requires a public relay or tunnel.
- 2026-05-12: Added Cloudflare Tunnel MVP path and verified a public HTTPS URL
  can expose the current-session phone web surface.
- 2026-05-12: Added polling fallback after observing that Cloudflare Quick
  Tunnel can return a connected SSE stream without delivering session events to
  the phone.
- 2026-05-12: Expanded startup backfill from recent lines to the previous
  completed turn plus the active turn, and added explicit phone input states.
- 2026-05-12: Switched the current test plan away from macOS UI automation when
  Accessibility permissions became unreliable. Bridge-owned app-server
  injection was tested as an intermediate path.
- 2026-05-12: Found that bridge-owned app-server injection can write the bound
  thread and stream to the phone, but the current Desktop UI does not show that
  reply process because it is a separate runtime. Added a Desktop IPC injector
  plan using `thread-follower-start-turn` so the owning Desktop window starts
  the phone-triggered turn.
- 2026-05-12: Verified that `send-message-v2` can create a separate session
  instead of injecting into the bound Desktop thread; added target-session
  validation and a temporary macOS UI injector for current-window testing.
- 2026-05-12: Observed macOS error `osascript` is not allowed to send
  keystrokes; added an injector notice and actionable phone-side failure message
  for Accessibility permission failures.
