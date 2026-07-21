# Runtime Patches

These scripts were extracted from the live Alibaba Cloud deployment and kept
here as optional runtime hotfixes.

Files:

- `generate_sub2api_index_override.mjs`
  Rebuilds `data/public/index.html` so the browser loads a versioned main
  bundle and avoids stale cache.
- `hotfix_sub2api_frontend.mjs`
  Patches the built frontend bundle to fix OpenAI OAuth redirect parameter
  handling when the admin page passes arguments in a different order.
- `patch_openai_row_refresh_button.mjs`
  Adds a per-account refresh button to the OpenAI usage cell in the admin page.
- `patch_openai_usage_remaining.mjs`
  Changes the OpenAI quota display from "used percent" to "remaining percent"
  and adjusts the bar width accordingly.

These scripts target built assets under `data/public/assets/`. They are not
required for a clean upstream deployment, but they are useful if you want to
reproduce the exact runtime fixes from this server.

Usage:

```bash
# Run from deploy/ so `data/public` resolves correctly
cd deploy
node ../patches/patch_openai_usage_remaining.mjs

# Or pass deploy directory explicitly
node patches/patch_openai_usage_remaining.mjs /absolute/path/to/deploy
```
