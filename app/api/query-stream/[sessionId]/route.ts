import { getQueryStream } from "@/lib/server/query-stream-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const encoder = new TextEncoder();

const serializeEvent = (event: { event: string; data: unknown }) =>
  encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);

export async function GET(_: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  let interval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let cursor = 0;
      let idleChecks = 0;

      controller.enqueue(encoder.encode(": connected\n\n"));

      interval = setInterval(() => {
        const state = getQueryStream(sessionId);

        if (state) {
          while (cursor < state.events.length) {
            controller.enqueue(
              serializeEvent({ event: "progress", data: state.events[cursor] }),
            );
            cursor += 1;
          }

          if (!state.active) {
            idleChecks += 1;
          } else {
            idleChecks = 0;
          }
        } else {
          idleChecks += 1;
        }

        controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));

        if (idleChecks >= 4) {
          clearInterval(interval);
          controller.close();
        }
      }, 500);

    },
    cancel() {
      if (interval) {
        clearInterval(interval);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
