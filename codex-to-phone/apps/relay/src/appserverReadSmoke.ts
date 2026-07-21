import { AppServerClient } from "./appServerClient.js";

const threadId = process.env.MOBILE_CODEX_TEST_THREAD_ID ?? "019e176f-6563-7e01-a480-0c58821578d9";
const client = new AppServerClient({
  port: Number(process.env.MOBILE_CODEX_APPSERVER_PORT ?? 18787),
});

type ThreadResponse = {
  thread: {
    id: string;
    name: string | null;
    cwd: string;
    source: unknown;
    turns: Array<{
      id: string;
      status: unknown;
      items: Array<{ type: string; text?: string; content?: unknown }>;
    }>;
  };
};

try {
  await client.start();
  const read = await client.request<ThreadResponse>("thread/read", {
    threadId,
    includeTurns: true,
  });
  const resume = await client.request<ThreadResponse>("thread/resume", {
    threadId,
    excludeTurns: false,
    persistExtendedHistory: true,
  });

  const firstTurnItems = resume.thread.turns[0]?.items ?? [];
  console.log(
    JSON.stringify(
      {
        read: {
          id: read.thread.id,
          name: read.thread.name,
          cwd: read.thread.cwd,
          source: read.thread.source,
          turnCount: read.thread.turns.length,
        },
        resume: {
          id: resume.thread.id,
          name: resume.thread.name,
          cwd: resume.thread.cwd,
          source: resume.thread.source,
          turnCount: resume.thread.turns.length,
          firstTurnItemTypes: firstTurnItems.slice(0, 8).map((item) => item.type),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await client.stop();
}
