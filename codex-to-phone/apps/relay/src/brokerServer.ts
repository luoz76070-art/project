import { createBroker, loadBrokerConfig } from "./transport/broker.js";
const config = loadBrokerConfig();
const app = createBroker(config);
await app.listen({ host: config.host, port: config.port });
