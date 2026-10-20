import { rm } from "node:fs/promises";
// Only remove this package's generated output, so moved modules cannot survive a build.
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
