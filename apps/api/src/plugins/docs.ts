import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * OpenAPI document generated from each route's Zod schemas.
 * JSON at /docs/json, interactive UI at /docs. Disabled in production.
 */
export async function registerDocs(app: FastifyInstance, version: string): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'MOM API',
        description: 'Campus food-stall pre-ordering. See spec.md §9.',
        version,
      },
      tags: [
        { name: 'ops', description: 'Health and readiness' },
        { name: 'auth', description: 'Phone OTP login and sessions (cookies)' },
        { name: 'me', description: 'The signed-in user' },
        { name: 'stalls', description: 'Public stall directory (no sign-in)' },
        { name: 'cart', description: 'Re-price a cart before checkout (public)' },
        { name: 'orders', description: 'Placing and viewing my orders (signed in)' },
        { name: 'vendor', description: 'Stall console (stall members and super admins)' },
        { name: 'admin', description: 'Super admin only; every change is audited' },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
}
