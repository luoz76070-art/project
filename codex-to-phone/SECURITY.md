# Security Policy

## Supported scope

Security fixes target the current source version on the default branch. Prebuilt APK and desktop application bundles are not committed to this repository.

## Deployment rules

- Use a unique Relay API token and a different Broker relay secret.
- Configure allowed relays with `MOBILE_CODEX_BROKER_RELAYS`.
- Use HTTPS/WSS for every public deployment.
- Keep `config.json`, `.env.local`, SSH keys, logs, uploads and build artifacts out of Git.
- Run the Broker with a non-root service account and place it behind a maintained reverse proxy.
- Restrict access to the Mac account because the input helper can control the visible Codex Desktop window.

`MOBILE_CODEX_BROKER_ALLOW_DYNAMIC_RELAYS=true` is intended only for local development. It allows an unconfigured relay ID to connect and must not be enabled on a public Broker.

## Reporting

Do not open a public issue containing credentials, private endpoints, Codex session data or local file paths. Report the minimum reproducible detail to the repository owner through a private GitHub security advisory.
