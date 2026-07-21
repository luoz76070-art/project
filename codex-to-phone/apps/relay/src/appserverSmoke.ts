import { AppServerClient } from "./appServerClient.js";

const client = new AppServerClient({
  port: Number(process.env.MOBILE_CODEX_APPSERVER_PORT ?? 18787),
});

try {
  await client.start();
  const response = await client.request<{
    data: Array<{
      id: string;
      name: string | null;
      preview: string;
      cwd: string;
      source: unknown;
      updatedAt: number;
    }>;
  }>("thread/list", {
    limit: 5,
    sortKey: "updated_at",
    sortDirection: "desc",
    archived: false,
  });

  console.log(JSON.stringify({ threadCount: response.data.length, threads: response.data }, null, 2));
} finally {
  await client.stop();
}
