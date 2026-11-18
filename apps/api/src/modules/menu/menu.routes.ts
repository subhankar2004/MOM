import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest } from '../../lib/errors.js';
import { requireRole, requireStallAccess } from '../../plugins/authz.js';
import {
  IMAGE_TYPES,
  itemImageKey,
  MAX_IMAGE_BYTES,
  type ImageStorage,
  type ImageType,
} from './image-storage.js';
import type { Actor, MenuService } from './menu.service.js';

const stallParams = z.object({ stallId: z.uuid('Not a valid stall id') });
const categoryParams = stallParams.extend({ categoryId: z.uuid('Not a valid category id') });
const itemParams = stallParams.extend({ itemId: z.uuid('Not a valid dish id') });

const categoryName = z
  .string()
  .trim()
  .min(1, 'Give the category a name')
  .max(40, 'Keep category names under 40 characters');

const category = z.object({ id: z.uuid(), name: z.string(), sortOrder: z.number().int() });

const item = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  pricePaise: z.number().int(),
  isVeg: z.boolean(),
  imageKey: z.string().nullable(),
  imageUrl: z.string().nullable(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int(),
});

const itemFields = z.object({
  categoryId: z.uuid('Pick a category'),
  name: z.string().trim().min(1, 'Give the dish a name').max(80, 'Keep dish names under 80 characters'),
  description: z.string().trim().max(300, 'Keep the description under 300 characters').nullable().optional(),
  pricePaise: z
    .number()
    .int('Price must be in whole paise')
    .min(100, 'The price must be at least ₹1')
    .max(1_000_000, 'The price must be ₹10,000 or less'),
  isVeg: z.boolean(),
  imageKey: z.string().max(200).nullable().optional(),
  isAvailable: z.boolean().optional(),
});

const idList = z.array(z.uuid()).min(1).max(500);
const noContent = { 204: z.null() };

export interface MenuRoutesOptions {
  menu: MenuService;
  storage: ImageStorage;
  now?: () => Date;
}

function actor(req: FastifyRequest): Actor {
  const ua = req.headers['user-agent'];
  return { userId: req.auth!.userId, ip: req.ip, userAgent: typeof ua === 'string' ? ua : undefined };
}

/**
 * /v1/vendor/stalls/:stallId/{menu,categories,items,uploads} — the menu editor (spec §6.2 V5).
 * Owners and super admins only: counter staff can't change dishes or prices (spec §3).
 */
export const menuRoutes: FastifyPluginAsyncZod<MenuRoutesOptions> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());
  const { menu } = opts;
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireRole('vendor_owner', 'super_admin'));
  app.addHook('preHandler', requireStallAccess(app.db, { memberRoles: ['owner'] }));

  app.get(
    '/stalls/:stallId/menu',
    {
      schema: {
        tags: ['menu'],
        summary: 'The full menu for editing (empty categories and sold-out dishes included)',
        params: stallParams,
        response: { 200: z.object({ categories: z.array(category.extend({ items: z.array(item) })) }) },
      },
    },
    async (req) => ({ categories: await menu.menu(req.params.stallId) }),
  );

  app.post(
    '/stalls/:stallId/categories',
    {
      schema: {
        tags: ['menu'],
        summary: 'Add a category (goes to the end)',
        params: stallParams,
        body: z.object({ name: categoryName }),
        response: { 201: z.object({ category }) },
      },
    },
    async (req, reply) =>
      reply.status(201).send({ category: await menu.createCategory(req.params.stallId, req.body.name) }),
  );

  app.put(
    '/stalls/:stallId/categories/order',
    {
      schema: {
        tags: ['menu'],
        summary: 'Reorder categories (send every category id, in the new order)',
        params: stallParams,
        body: z.object({ ids: idList }),
        response: noContent,
      },
    },
    async (req, reply) => {
      await menu.reorderCategories(req.params.stallId, req.body.ids);
      return reply.status(204).send(null);
    },
  );

  app.patch(
    '/stalls/:stallId/categories/:categoryId',
    {
      schema: {
        tags: ['menu'],
        summary: 'Rename a category',
        params: categoryParams,
        body: z.object({ name: categoryName }),
        response: { 200: z.object({ category }) },
      },
    },
    async (req) => ({
      category: await menu.renameCategory(req.params.stallId, req.params.categoryId, req.body.name),
    }),
  );

  app.delete(
    '/stalls/:stallId/categories/:categoryId',
    {
      schema: {
        tags: ['menu'],
        summary: 'Delete an empty category',
        params: categoryParams,
        response: noContent,
      },
    },
    async (req, reply) => {
      await menu.deleteCategory(req.params.stallId, req.params.categoryId, now());
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/stalls/:stallId/categories/:categoryId/items/order',
    {
      schema: {
        tags: ['menu'],
        summary: "Reorder a category's dishes (send every dish id in it, in the new order)",
        params: categoryParams,
        body: z.object({ ids: idList }),
        response: noContent,
      },
    },
    async (req, reply) => {
      await menu.reorderItems(req.params.stallId, req.params.categoryId, req.body.ids);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/stalls/:stallId/items',
    {
      schema: {
        tags: ['menu'],
        summary: 'Add a dish (upload its photo first with /uploads/presign)',
        params: stallParams,
        body: itemFields,
        response: { 201: z.object({ item }) },
      },
    },
    async (req, reply) =>
      reply.status(201).send({ item: await menu.createItem(req.params.stallId, req.body, actor(req)) }),
  );

  app.post(
    '/stalls/:stallId/items/availability',
    {
      schema: {
        tags: ['menu'],
        summary: 'Mark dishes available or sold out (all of them unless itemIds is given)',
        params: stallParams,
        body: z.object({ available: z.boolean(), itemIds: idList.optional() }),
        response: { 200: z.object({ changed: z.number().int() }) },
      },
    },
    async (req) => ({
      changed: await menu.setAvailability(req.params.stallId, req.body.available, req.body.itemIds),
    }),
  );

  app.patch(
    '/stalls/:stallId/items/:itemId',
    {
      schema: {
        tags: ['menu'],
        summary: 'Change a dish (price changes are audited; imageKey null removes the photo)',
        params: itemParams,
        body: itemFields.partial(),
        response: { 200: z.object({ item }) },
      },
    },
    async (req) => ({
      item: await menu.updateItem(req.params.stallId, req.params.itemId, req.body, actor(req)),
    }),
  );

  app.delete(
    '/stalls/:stallId/items/:itemId',
    {
      schema: {
        tags: ['menu'],
        summary: 'Delete a dish (past orders keep it)',
        params: itemParams,
        response: noContent,
      },
    },
    async (req, reply) => {
      await menu.deleteItem(req.params.stallId, req.params.itemId, actor(req), now());
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/stalls/:stallId/uploads/presign',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (req) => (req.auth ? `user:${req.auth.userId}` : `ip:${req.ip}`),
        },
      },
      schema: {
        tags: ['menu'],
        summary: "Get a short-lived URL to upload a dish photo to this stall's folder (≤ 2 MB)",
        params: stallParams,
        body: z.object({
          contentType: z.enum(Object.keys(IMAGE_TYPES) as [ImageType, ...ImageType[]], {
            error: 'Photos must be WebP, JPEG or PNG',
          }),
          size: z.number().int().positive(),
        }),
        response: {
          200: z.object({
            key: z.string(),
            uploadUrl: z.string(),
            headers: z.record(z.string(), z.string()),
            publicUrl: z.string(),
            expiresAt: z.date(),
          }),
        },
      },
    },
    async (req) => {
      if (req.body.size > MAX_IMAGE_BYTES) throw badRequest('Photos must be 2 MB or smaller');
      const upload = await opts.storage.presignPut({
        key: itemImageKey(req.params.stallId, req.body.contentType),
        contentType: req.body.contentType,
        size: req.body.size,
      });
      return {
        key: upload.key,
        uploadUrl: upload.url,
        headers: upload.headers,
        publicUrl: menu.imageUrl(upload.key),
        expiresAt: upload.expiresAt,
      };
    },
  );
};
