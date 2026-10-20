import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles.css";

import { initializeCredentials } from "./features/connection/profiles";

async function start() {
  await initializeCredentials();
  createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
}
void start().catch(() => {
  const root = document.getElementById("root");
  if (root) root.textContent = "无法解锁本机连接凭证，请重启应用后重试。";
});
