# Mobile Session Remote Connectivity

## Conclusion

Same-network access is useful only for local development. It does not satisfy
the product goal because the user wants to leave the PC network and still
monitor or control the current Codex session.

The production architecture needs a remote connectivity layer. The PC bridge
should initiate the outbound connection, because most user machines are behind
NAT, home routers, campus networks, company networks, or mobile hotspots.

## Recommended Connectivity Options

### Option A: Cloudflare Tunnel For MVP

Best first implementation for real-world testing.

Flow:

1. PC starts the local bridge on `127.0.0.1`.
2. PC starts a Cloudflare quick tunnel to the bridge.
3. The bridge prints a public HTTPS URL.
4. Phone opens the public URL from any network.

Pros:

- No router configuration.
- HTTPS URL works from cellular networks.
- Fastest path to a public test.
- Keeps the bridge local and token-protected.

Cons:

- Requires `cloudflared` installed on the PC.
- Quick tunnels are temporary and not ideal for a stable product.
- Production use needs a managed domain and tunnel policy.
- Server-sent events can appear connected while event data is buffered or not
  delivered through the quick tunnel. The MVP should keep a polling fallback for
  session events and send acknowledgements.

Example command shape:

```bash
cloudflared tunnel --url http://127.0.0.1:8765
```

Then start the bridge with:

```bash
node plugins/codex-live-session/scripts/bridge.mjs \
  --rollout-file ~/.codex/sessions/<date>/rollout-<session>.jsonl \
  --thread-id <session-id> \
  --injector ui \
  --host 127.0.0.1 \
  --public-url https://<cloudflare-tunnel-host>
```

### Option B: Hosted WSS Relay

Best long-term product architecture.

Flow:

1. PC bridge opens an outbound WebSocket to the relay.
2. Phone app opens another WebSocket to the relay.
3. Relay matches both sides by a short-lived pairing token.
4. Relay forwards encrypted session events and phone commands.
5. Relay stores no timeline by default.

Pros:

- Works from any network.
- Natural fit for native mobile app.
- Can add push notifications, reconnect, and multi-region reliability.
- Does not expose a raw HTTP server on the user's PC.

Cons:

- Requires operating relay infrastructure.
- Requires protocol design for auth, pairing, reconnect, and message ack.
- More code than a simple tunnel.

This is the target architecture once the current-session bridge is verified.

### Option C: User-Owned Relay

Useful for self-hosted or privacy-sensitive users.

Flow is the same as hosted WSS relay, but the relay runs on the user's VPS.

Pros:

- User controls relay data path.
- Avoids vendor lock-in.

Cons:

- Harder onboarding.
- Requires server/domain/TLS setup.

### Option D: VPN / Mesh Network

Examples: Tailscale, ZeroTier, WireGuard.

Pros:

- Good for technical users.
- Keeps the bridge private.

Cons:

- Both PC and phone need VPN client setup.
- Not appropriate as the default consumer workflow.

## Recommended Roadmap

### Phase 1: Cloudflare Tunnel Test

Goal: prove the phone can reach the current-session bridge from cellular data.

Tasks:

- Add a helper script that starts the bridge locally.
- Start `cloudflared tunnel --url http://127.0.0.1:<port>`.
- Parse the public URL and display it as the pairing URL.
- Keep the existing short-lived token requirement.

Acceptance:

- Phone can open the URL from cellular data.
- Phone sees current-session updates.
- Phone can send a text command back to Codex.
- If the streaming channel stalls, the phone still receives updates through
  polling within a few seconds.
- On bridge startup, the phone receives only the previous completed turn, not an
  arbitrary fixed number of recent JSONL lines.
- Phone send state distinguishes accepted, queued, sending, sent, and failed.

### Phase 2: Relay Protocol

Goal: replace generic tunnel with product-owned session relay.

Minimal protocol:

- `bridge.hello`: PC bridge registers `bridgeId`, `pairingTokenHash`, and expiry.
- `phone.hello`: phone claims a `bridgeId` using the pairing token.
- `session.event`: PC-to-phone timeline event.
- `phone.input`: phone-to-PC user text.
- `ack`: idempotent delivery acknowledgement.
- `session.closed`: bridge has shut down.

Security requirements:

- Pairing token expires quickly.
- Token is never logged in plaintext by the relay.
- Relay does not persist timeline by default.
- Every phone command includes `clientMessageId` for dedupe.
- PC bridge remains the only component allowed to call Codex APIs.

### Phase 3: Native App

Goal: replace the phone web page with a native app surface.

The native app can reuse the same relay protocol:

- QR/deep-link pairing.
- Timeline view.
- Message composer.
- Connection state.
- Optional push notification when Codex needs attention.

## Current Local State

The current bridge already supports public tunnel usage. The helper script
`plugins/codex-live-session/scripts/start-cloudflare-tunnel.mjs` starts the
current-session bridge, launches `cloudflared`, parses the temporary public URL,
and prints a phone-ready URL with the pairing token.

The current phone web page uses both SSE and polling. Polling is required for
the Cloudflare quick tunnel path because local SSE can deliver events while the
public tunnel reports connected but does not flush event data to the phone.

For current Desktop testing, `codex debug app-server send-message-v2` is not a
reliable injector because it can create a standalone session. A bridge-owned
`codex app-server` can write the bound rollout and stream back to the phone, but
it still does not make the current Desktop window show the phone-triggered reply
process because the UI is not subscribed to that separate runtime.

The current default test injector is now `ui`. The bridge opens the bound
`codex://threads/<threadId>` route, pastes the phone message into the visible
Codex Desktop input, submits it, and verifies that the phone message is written
to the bound rollout file.

The QR URL carries both a short token and `session=<threadId>`. The bridge
rejects requests without the exact startup session binding, so a stale QR cannot
control another conversation.

Desktop IPC remains an explicit experimental mode. If it reports
`no-client-found`, use the default UI injector until owner registration can be
made reliable.
