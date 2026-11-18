import type { FastifyReply, FastifyRequest } from 'fastify';

export const SSE_HEARTBEAT_MS = 25_000;

/**
 * Turns the request into a Server-Sent Events stream. `subscribe` receives a `send` function
 * and returns a cleanup. A comment line every 25 s keeps proxies and the AWS load balancer
 * (idle timeout must be > 25 s) from closing an idle connection.
 */
export function openEventStream<E extends { id: string }>(
  req: FastifyRequest,
  reply: FastifyReply,
  subscribe: (send: (event: E) => void) => { unsubscribe: () => void; resync: boolean },
  opts: { heartbeatMs?: number; onShutdown?: (fn: () => void) => () => void } = {},
): void {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>), // CORS, request id, security headers
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  // Ask browsers to reconnect after 3 s if the connection drops.
  res.write('retry: 3000\n\n');

  const send = (event: E) => {
    res.write(`id: ${event.id}\nevent: order\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const { unsubscribe, resync } = subscribe(send);
  // "ready" tells the client it's connected; "resync" that it missed events and should refetch.
  res.write(`event: ${resync ? 'resync' : 'ready'}\ndata: {}\n\n`);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), opts.heartbeatMs ?? SSE_HEARTBEAT_MS);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    forgetShutdown?.();
  };
  // On server shutdown, end the stream so the process can exit (the browser reconnects to
  // another container).
  const forgetShutdown = opts.onShutdown?.(() => {
    close();
    res.end();
  });
  req.raw.on('close', close);
  res.on('error', close);
}
