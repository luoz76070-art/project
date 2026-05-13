# Install And Reproduce

This guide is the user-facing installation manual for Codex To Phone.

## 1. Requirements

- macOS with Codex Desktop installed and running.
- Node.js 22 or later.
- Homebrew, for installing Cloudflare Tunnel.
- A phone with camera or browser.

Install Cloudflare Tunnel:

```bash
brew install cloudflared
```

## 2. Download

```bash
git clone https://github.com/luoz76070-art/project.git
cd project/codex-to-phone
npm install
```

## 3. Run Without Installing The Plugin

Open the target Codex Desktop conversation window, then run:

```bash
npm start
```

The terminal prints:

- a PNG QR image path;
- the bound thread id and rollout file.

Scan the QR image with the phone. Keep the Codex Desktop conversation window open.

## 4. Install As A Codex Local Plugin

Run once:

```bash
npm run plugin:install
```

This creates:

- a symlink at `~/plugins/codex-to-phone`;
- or refreshes a local marketplace entry at `~/.agents/plugins/marketplace.json`.

Restart Codex Desktop after installation.

Then ask Codex:

```text
启动 Codex To Phone
```

The Codex To Phone skill will run:

```bash
cd <plugin-root>
npm install
npm run plugin:start
```

It starts the service in the background and prints a local PNG QR image path as the pairing output. The Codex skill renders that image in the final response.

## 5. Daily Use

Start:

```text
启动 Codex To Phone
```

Status:

```text
查看 Codex To Phone 状态
```

Stop:

```text
停止 Codex To Phone
```

Equivalent shell commands:

```bash
npm run plugin:start
npm run plugin:status
npm run plugin:stop
npm run plugin:url
npm run plugin:lan
```

## 6. Expected Phone UI

The phone page shows:

- user inputs;
- Codex assistant messages;
- compact tool-call summaries;
- final results.

It intentionally hides:

- full code patches;
- full command output;
- bridge-level accepted/sending/sent acknowledgements.

## 7. Update

```bash
cd project
git pull
cd codex-to-phone
npm install
npm run plugin:install
```

Restart Codex Desktop if plugin metadata or skill text changed.

## 8. Troubleshooting

If `cloudflared` is missing:

```bash
brew install cloudflared
```

If the QR image does not appear:

```bash
npm run plugin:status
npm run plugin:url
tail -120 ~/.codex-to-phone/service.log
```

If Android browser shows error `-2`, the phone likely cannot resolve the Cloudflare quick-tunnel host. Use the LAN fallback while the phone and computer are on the same Wi-Fi:

```bash
npm run plugin:lan
```

If phone input returns `no-client-found`, open the matching Codex Desktop conversation window and retry.

If the phone page opens but does not update immediately, wait a few seconds or reload the page. The UI uses polling as a fallback when SSE is delayed by the tunnel.
