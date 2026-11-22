import { paise } from '@mom/shared';
import { count, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  menuCategories,
  menuItems,
  platformSettings,
  stallHours,
  stallMembers,
  stalls,
  users,
} from '../schema/index.js';
import { DEFAULT_SETTINGS, DEMO_ACCOUNTS, DEMO_STALLS } from './demo-data.js';

export interface SeedOptions {
  /** E.164 phones that become super admins. */
  superAdminPhones: string[];
  /** Insert the 4 demo stalls (local/staging only). */
  demoStalls: boolean;
}

export interface SeedResult {
  settingsCreated: boolean;
  superAdmins: number;
  stallsCreated: string[];
  stallsSkipped: string[];
  demoAccounts: number;
}

/**
 * Idempotent seed — safe to run again: existing settings, users and stalls are left alone
 * (super-admin phones are only promoted). Runs in one transaction: all or nothing.
 */
export async function seed(db: Db, options: SeedOptions): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const result: SeedResult = {
      settingsCreated: false,
      superAdmins: 0,
      stallsCreated: [],
      stallsSkipped: [],
      demoAccounts: 0,
    };

    const [settingsCount] = await tx.select({ n: count() }).from(platformSettings);
    if (!settingsCount?.n) {
      await tx.insert(platformSettings).values(DEFAULT_SETTINGS);
      result.settingsCreated = true;
    }

    for (const phone of options.superAdminPhones) {
      await tx
        .insert(users)
        .values({ phone, role: 'super_admin' })
        .onConflictDoUpdate({ target: users.phone, set: { role: 'super_admin', updatedAt: sql`now()` } });
      result.superAdmins++;
    }

    if (!options.demoStalls) return result;

    for (const demo of DEMO_STALLS) {
      const [stall] = await tx
        .insert(stalls)
        .values({
          slug: demo.slug,
          name: demo.name,
          description: demo.description,
          location: demo.location,
          cuisineTags: demo.cuisineTags,
          isVegOnly: demo.isVegOnly,
          status: 'active',
          avgPrepMinutes: demo.avgPrepMinutes,
          parallelCapacity: demo.parallelCapacity,
          upiEnabled: demo.upiEnabled,
          cashEnabled: demo.cashEnabled,
          // Demo only: pretend Route onboarding is done for stalls that accept UPI.
          routeStatus: demo.upiEnabled ? 'activated' : 'not_started',
        })
        .onConflictDoNothing({ target: stalls.slug })
        .returning({ id: stalls.id });

      if (!stall) {
        result.stallsSkipped.push(demo.slug);
        continue;
      }

      await tx.insert(stallHours).values(
        demo.hours.map(([weekday, opensAt, closesAt]) => ({
          stallId: stall.id,
          weekday,
          opensAt,
          closesAt,
        })),
      );

      for (const [categoryIndex, { category, items }] of demo.menu.entries()) {
        const [cat] = await tx
          .insert(menuCategories)
          .values({ stallId: stall.id, name: category, sortOrder: categoryIndex })
          .returning({ id: menuCategories.id });
        await tx.insert(menuItems).values(
          items.map((item, itemIndex) => ({
            stallId: stall.id,
            categoryId: cat!.id,
            name: item.name,
            description: item.description,
            pricePaise: paise(item.price),
            isVeg: item.veg,
            isAvailable: item.available ?? true,
            sortOrder: itemIndex,
          })),
        );
      }
      result.stallsCreated.push(demo.slug);
    }

    // Demo accounts (named, so there's no name step) and their stall memberships.
    for (const account of DEMO_ACCOUNTS) {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.phone} = ${account.phone}`);
      const id =
        existing?.id ??
        (
          await tx
            .insert(users)
            .values({ phone: account.phone, name: account.name, role: account.role })
            .returning({ id: users.id })
        )[0]!.id;
      if (!existing) result.demoAccounts++;
      if (account.stall) {
        const [stall] = await tx
          .select({ id: stalls.id })
          .from(stalls)
          .where(sql`${stalls.slug} = ${account.stall.slug}`);
        if (stall) {
          await tx
            .insert(stallMembers)
            .values({ stallId: stall.id, userId: id, role: account.stall.role })
            .onConflictDoNothing();
        }
      }
    }

    return result;
  });
}
