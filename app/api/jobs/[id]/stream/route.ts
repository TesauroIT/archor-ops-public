import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const POLL_MS = 1000;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const encoder = new TextEncoder();
  let sentLength = 0;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const poll = async () => {
        if (closed) return;

        const job = await prisma.job.findUnique({
          where: { id },
          select: { status: true, output: true },
        });
        if (!job) {
          send("error", { message: "Job no encontrado." });
          closed = true;
          controller.close();
          return;
        }

        if (job.output.length > sentLength) {
          send("output", { chunk: job.output.slice(sentLength) });
          sentLength = job.output.length;
        }

        if (job.status === "SUCCESS" || job.status === "FAILED") {
          send("done", { status: job.status });
          closed = true;
          controller.close();
          return;
        }

        setTimeout(poll, POLL_MS);
      };

      poll();
    },
    cancel() {
      closed = true;
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
