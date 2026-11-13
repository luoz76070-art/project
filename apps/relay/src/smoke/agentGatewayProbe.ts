import os from "node:os";
import path from "node:path";
import { createAgentGateway } from "../agents/agentGateway.js";

// Explicit manual integration probe. Never run from unit tests or start a turn here.
const gateway = createAgentGateway({ codexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex") });
try {
  const status = await gateway.probe("codex");
  console.log(JSON.stringify(status, null, 2));
  if (status.state !== "connected") process.exitCode = 1;
} finally {
  await gateway.stop();
}
