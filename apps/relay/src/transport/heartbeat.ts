import WebSocket from "ws";

export function attachHeartbeat(socket: WebSocket, intervalMs = 15_000, onTimeout?: () => void): void {
  let alive = true;
  const pong = () => { alive = true; };
  socket.on("pong", pong);
  const timer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!alive) { onTimeout?.(); socket.terminate(); return; }
    alive = false;
    socket.ping(undefined, undefined, (error) => { if (error) socket.terminate(); });
  }, intervalMs);
  timer.unref();
  socket.once("close", () => { clearInterval(timer); socket.off("pong", pong); });
}
