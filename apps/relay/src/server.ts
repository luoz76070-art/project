import { loadConfig } from "./config.js";
import { createRelayServer } from "./server/createRelayServer.js";

async function main() {
  const config = loadConfig();
  const app = await createRelayServer({ config });
  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
