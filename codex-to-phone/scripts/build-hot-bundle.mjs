import process from "node:process";
import { buildHotBundle } from "../apps/mobile/scripts/build-hot-bundle.mjs";

const cliArgs = process.argv.slice(2).filter((argument) => argument !== "--");
const result = await buildHotBundle(process.cwd(), cliArgs[0] ?? "local");
console.log(`HOT_BUNDLE=${result.output}`);
console.log(`SHA256=${result.sha256}`);
console.log(`SIZE=${result.size}`);
