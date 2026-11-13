import { gatewayErrorMessage, runGatewayCli } from "./cli.js";

try { console.log(JSON.stringify(await runGatewayCli(process.argv.slice(2), process.argv[1]))); }
catch (error) { console.error(JSON.stringify(gatewayErrorMessage(error))); process.exitCode = 1; }
