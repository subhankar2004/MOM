import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { quoteCart } from './quote.service.js';

const fees = z
  .object({
    subtotalPaise: z.number().int(),
    platformFeePaise: z.number().int(),
    cashFeePaise: z.number().int(),
    totalPaise: z.number().int(),
  })
  .nullable();

/** POST /v1/cart/quote — public: re-price a cart before checkout. */
export const cartRoutes: FastifyPluginAsyncZod<{ now?: () => Date; upiOnline: boolean }> = async (
  app,
  opts,
) => {
  const now = opts.now ?? (() => new Date());

  app.post(
    '/quote',
    {
      schema: {
        tags: ['cart'],
        summary: 'Check prices and availability, and get the bill for UPI and cash',
        body: z.object({
          stallId: z.uuid('Not a valid stall id'),
          items: z
            .array(
              z.object({
                itemId: z.uuid('Not a valid dish id'),
                quantity: z.number().int().min(1).max(20),
                pricePaise: z.number().int().min(0).max(10_000_000),
              }),
            )
            .max(30, 'At most 30 different dishes per order')
            .refine(
              (items) => new Set(items.map((i) => i.itemId)).size === items.length,
              'Each dish only once',
            ),
        }),
        response: {
          200: z.object({
            stall: z.object({
              id: z.uuid(),
              slug: z.string(),
              name: z.string(),
              state: z.enum(['open', 'paused', 'closed']),
            }),
            lines: z.array(
              z.object({
                itemId: z.uuid(),
                name: z.string().nullable(),
                quantity: z.number().int(),
                status: z.enum(['ok', 'price_changed', 'unavailable', 'removed']),
                unitPricePaise: z.number().int().nullable(),
                previousPricePaise: z.number().int().nullable(),
                lineTotalPaise: z.number().int(),
              }),
            ),
            subtotalPaise: z.number().int(),
            rates: z.object({ platformFeeBps: z.number().int(), cashFeeBps: z.number().int() }),
            options: z.object({ upi: fees, cash: fees }),
            problems: z.array(
              z.enum(['stall_closed', 'stall_paused', 'no_payment_method', 'items_need_attention', 'empty']),
            ),
            canCheckout: z.boolean(),
          }),
        },
      },
    },
    async (req) => quoteCart(app.db, req.body, now(), { upiOnline: opts.upiOnline }),
  );
};
