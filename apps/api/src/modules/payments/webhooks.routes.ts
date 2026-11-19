import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { webhookEvents } from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import type { PaymentGateway } from './gateway.js';
import { ensureTransfer, onTransferWebhook } from '../finance/transfers.service.js';
import { confirmPayment, markPaymentFailed, refundOrder } from './payments.service.js';
import { verifyWebhookSignature } from './signatures.js';

interface RazorpayEvent {
  event: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } };
    transfer?: { entity?: { id: string; error?: { description?: string; reason?: string } | null } };
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/**
 * POST /v1/webhooks/razorpay — Razorpay tells us about payments directly. This is the safety
 * net when the student closes the browser right after paying (spec §4.2 step 4).
 * Signed with our webhook secret over the raw body; each event is processed at most once.
 */
export const razorpayWebhookRoutes: FastifyPluginAsync<{
  gateway: PaymentGateway;
  webhookSecret: string;
  now?: () => Date;
}> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());

  // Keep the exact bytes: the signature is computed over the raw body (this plugin only).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new AppError(400, 'BAD_REQUEST', 'Invalid JSON'), undefined);
    }
  });

  app.post(
    '/razorpay',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const signature = req.headers['x-razorpay-signature'];
      if (
        typeof signature !== 'string' ||
        !req.rawBody ||
        !verifyWebhookSignature(opts.webhookSecret, req.rawBody, signature)
      ) {
        req.log.warn({ ip: req.ip }, 'rejected Razorpay webhook with a bad signature');
        throw new AppError(401, 'UNAUTHENTICATED', 'Invalid signature');
      }
      const event = req.body as RazorpayEvent;
      const eventId =
        (req.headers['x-razorpay-event-id'] as string | undefined) ??
        `${event.event}:${event.payload?.payment?.entity?.id ?? ''}:${event.created_at ?? ''}`;

      // Record the event; if it was already processed, this is a duplicate delivery → ignore.
      const [stored] = await app.db
        .insert(webhookEvents)
        .values({ provider: 'razorpay', eventId, eventType: event.event, payload: event })
        .onConflictDoUpdate({
          target: [webhookEvents.provider, webhookEvents.eventId],
          set: { receivedAt: new Date() },
        })
        .returning();
      if (stored!.processedAt) return reply.status(200).send({ status: 'duplicate' });

      const payment = event.payload?.payment?.entity;
      try {
        if (
          (event.event === 'payment.captured' || event.event === 'order.paid') &&
          payment?.order_id &&
          payment.id
        ) {
          const result = await confirmPayment(
            app.db,
            {
              razorpayOrderId: payment.order_id,
              razorpayPaymentId: payment.id,
              amountPaise: payment.amount,
              raw: payment,
            },
            now(),
          );
          if (result.outcome === 'late') {
            await refundOrder(
              app.db,
              opts.gateway,
              { orderId: result.orderId, reason: 'Paid after the order expired', actorId: null },
              req.log,
            );
          } else {
            // The stall's share, held until pickup (retried by the job if Razorpay is down).
            await ensureTransfer(app.db, opts.gateway, result.orderId, req.log);
          }
          req.log.info(
            { event: event.event, orderId: result.orderId, outcome: result.outcome },
            'Razorpay webhook processed',
          );
        } else if (event.event === 'payment.failed' && payment?.order_id) {
          await markPaymentFailed(app.db, payment.order_id, payment);
        } else if (
          (event.event === 'transfer.processed' || event.event === 'transfer.failed') &&
          event.payload?.transfer?.entity?.id
        ) {
          // Route webhooks (spec §4.2): a held transfer failed (e.g. Razorpay balance) → admin sees it.
          await onTransferWebhook(app.db, event.event, event.payload.transfer.entity, req.log);
        }
        await app.db
          .update(webhookEvents)
          .set({ processedAt: new Date(), error: null })
          .where(and(eq(webhookEvents.provider, 'razorpay'), eq(webhookEvents.eventId, eventId)));
        return reply.status(200).send({ status: 'ok' });
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 404) {
          // Not one of our payments (e.g. made from the Razorpay dashboard): acknowledge and ignore.
          req.log.warn({ event: event.event, eventId }, 'webhook for an unknown Razorpay order; ignored');
          await app.db
            .update(webhookEvents)
            .set({ processedAt: new Date(), error: 'unknown order' })
            .where(and(eq(webhookEvents.provider, 'razorpay'), eq(webhookEvents.eventId, eventId)));
          return reply.status(200).send({ status: 'ignored' });
        }
        // Not marked processed: Razorpay retries, and the retry is handled normally.
        await app.db
          .update(webhookEvents)
          .set({ error: (err as Error).message.slice(0, 500) })
          .where(and(eq(webhookEvents.provider, 'razorpay'), eq(webhookEvents.eventId, eventId)));
        throw err;
      }
    },
  );
};
