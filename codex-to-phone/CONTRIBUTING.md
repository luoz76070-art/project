# Contributing to Codex To Phone

Contributions are welcome through GitHub pull requests.

## Development flow

1. Fork the public repository.
2. Create a focused branch from `main`.
3. Make changes only inside `codex-to-phone/` unless the repository-level CI also needs an update.
4. Run:

   ```bash
   corepack pnpm install --frozen-lockfile
   corepack pnpm test:messages
   corepack pnpm typecheck
   corepack pnpm build
   ```

5. Open a pull request describing the user-visible behavior, verification performed and any remaining platform limitations.

## Security and privacy

Do not commit Relay tokens, Broker secrets, APK signing keys, SSH keys, private endpoints, Codex session data, uploaded files, local logs or absolute user paths.

Security issues containing sensitive information should be reported through a private GitHub security advisory instead of a public issue.

## Direct write access

Public repositories allow any GitHub user to fork the code and submit a pull request. Direct commit access is granted only to individually invited collaborators after review; it cannot be safely enabled for every GitHub account.
