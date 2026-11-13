import { loadTunnelConfig, startTunnel } from "./transport/tunnel.js";
const tunnel = startTunnel(loadTunnelConfig());
process.once("SIGTERM", () => tunnel.stop());
process.once("SIGINT", () => tunnel.stop());
await tunnel.done;
