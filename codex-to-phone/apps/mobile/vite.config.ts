import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { randomUUID } from "node:crypto";

export default defineConfig({
  plugins: [react()],
  define: { __WEB_BUILD_ID__: JSON.stringify(`web-${randomUUID()}`) },
  server: {
    host: "0.0.0.0",
    port: 5178,
    allowedHosts: true,
  },
});
