import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { menuCategories, menuItems } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { assertUploadedImage, type ImageStorage } from './image-storage.js';

type ItemRow = typeof menuItems.$inferSelect;

export interface VendorMenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  isVeg: boolean;
  imageKey: string | null;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
}

export interface VendorMenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: VendorMenuItem[];
}

/** Who is making a change, for the audit log. */
export interface Actor {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface ItemInput {
  categoryId: string;
  name: string;
  description?: string | null;
  pricePaise: number;
  isVeg: boolean;
  imageKey?: string | null;
  isAvailable?: boolean;
}

const live = {
  category: (stallId: string) => and(eq(menuCategories.stallId, stallId), isNull(menuCategories.deletedAt)),
  item: (stallId: string) => and(eq(menuItems.stallId, stallId), isNull(menuItems.deletedAt)),
};

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = (err as { cause?: unknown })?.cause ?? err;
  return (
    (e as { code?: string })?.code === '23505' && (e as { constraint?: string })?.constraint === constraint
  );
}

const DUPLICATE_CATEGORY = 'menu_categories_stall_name_unique';

/**
 * The stall's menu editor (spec §6.2 V5): categories (including empty ones) and every
 * item that isn't deleted, sold out or not.
 */
export class MenuService {
  private readonly imageBase: string;

  constructor(
    private readonly db: Db,
    private readonly storage: ImageStorage,
    options: { publicImageBaseUrl: string },
  ) {
    this.imageBase = options.publicImageBaseUrl.replace(/\/$/, '');
  }

  imageUrl(key: string): string {
    return `${this.imageBase}/${key}`;
  }

  async menu(stallId: string): Promise<VendorMenuCategory[]> {
    const [categories, items] = await Promise.all([
      this.db
        .select({ id: menuCategories.id, name: menuCategories.name, sortOrder: menuCategories.sortOrder })
        .from(menuCategories)
        .where(live.category(stallId))
        .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name)),
      this.db
        .select()
        .from(menuItems)
        .where(live.item(stallId))
        .orderBy(asc(menuItems.sortOrder), asc(menuItems.name)),
    ]);
    return categories.map((c) => ({
      ...c,
      items: items.filter((i) => i.categoryId === c.id).map((i) => this.toItem(i)),
    }));
  }

  // ── Categories ──────────────────────────────────────────────────────────

  async createCategory(stallId: string, name: string) {
    const [{ last } = { last: null }] = await this.db
      .select({ last: max(menuCategories.sortOrder) })
      .from(menuCategories)
      .where(live.category(stallId));
    try {
      // Own transaction, so a duplicate name only rolls back this insert.
      const [row] = await this.db.transaction((tx) =>
        tx
          .insert(menuCategories)
          .values({ stallId, name, sortOrder: (last ?? -1) + 1 })
          .returning({
            id: menuCategories.id,
            name: menuCategories.name,
            sortOrder: menuCategories.sortOrder,
          }),
      );
      return row!;
    } catch (err) {
      if (isUniqueViolation(err, DUPLICATE_CATEGORY)) throw conflict(`There's already a "${name}" category`);
      throw err;
    }
  }

  async renameCategory(stallId: string, categoryId: string, name: string) {
    try {
      const [row] = await this.db.transaction((tx) =>
        tx
          .update(menuCategories)
          .set({ name })
          .where(and(eq(menuCategories.id, categoryId), live.category(stallId)))
          .returning({
            id: menuCategories.id,
            name: menuCategories.name,
            sortOrder: menuCategories.sortOrder,
          }),
      );
      if (!row) throw notFound('Category not found');
      return row;
    } catch (err) {
      if (isUniqueViolation(err, DUPLICATE_CATEGORY)) throw conflict(`There's already a "${name}" category`);
      throw err;
    }
  }

  /** Only empty categories can be deleted, so dishes never disappear by accident. */
  async deleteCategory(stallId: string, categoryId: string, now: Date) {
    await this.db.transaction(async (tx) => {
      const [category] = await tx
        .select({ id: menuCategories.id })
        .from(menuCategories)
        .where(and(eq(menuCategories.id, categoryId), live.category(stallId)))
        .for('update');
      if (!category) throw notFound('Category not found');
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(menuItems)
        .where(and(eq(menuItems.categoryId, categoryId), live.item(stallId)));
      if (n > 0) throw conflict('Move or delete the dishes in this category first');
      await tx.update(menuCategories).set({ deletedAt: now }).where(eq(menuCategories.id, categoryId));
    });
  }

  async reorderCategories(stallId: string, ids: string[]) {
    const current = await this.db
      .select({ id: menuCategories.id })
      .from(menuCategories)
      .where(live.category(stallId));
    assertSameSet(
      current.map((c) => c.id),
      ids,
      'categories',
    );
    await this.db.execute(sql`
      update ${menuCategories} c set sort_order = v.ord - 1
      from unnest(${toUuidArray(ids)}) with ordinality as v(id, ord)
      where c.id = v.id and c.stall_id = ${stallId}`);
  }

  // ── Items ───────────────────────────────────────────────────────────────

  async createItem(stallId: string, input: ItemInput, actor: Actor): Promise<VendorMenuItem> {
    if (input.imageKey) await this.checkImage(stallId, input.imageKey);
    const row = await this.db.transaction(async (tx) => {
      await this.liveCategory(tx, stallId, input.categoryId);
      const sortOrder = await this.nextItemSort(tx, stallId, input.categoryId);
      const [created] = await tx
        .insert(menuItems)
        .values({
          stallId,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description || null,
          pricePaise: input.pricePaise,
          isVeg: input.isVeg,
          imageKey: input.imageKey ?? null,
          isAvailable: input.isAvailable ?? true,
          sortOrder,
        })
        .returning();
      await audit(tx, {
        actorId: actor.userId,
        action: 'menu.item.create',
        entity: 'menu_item',
        entityId: created!.id,
        after: { stallId, name: created!.name, pricePaise: created!.pricePaise },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      return created!;
    });
    return this.toItem(row);
  }

  async updateItem(
    stallId: string,
    itemId: string,
    patch: Partial<ItemInput>,
    actor: Actor,
  ): Promise<VendorMenuItem> {
    if (patch.imageKey) await this.checkImage(stallId, patch.imageKey);
    const { row, oldImage } = await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(menuItems)
        .where(and(eq(menuItems.id, itemId), live.item(stallId)))
        .for('update');
      if (!before) throw notFound('Dish not found');

      const changes: Partial<typeof menuItems.$inferInsert> = {};
      if (patch.name !== undefined) changes.name = patch.name;
      if (patch.description !== undefined) changes.description = patch.description || null;
      if (patch.pricePaise !== undefined) changes.pricePaise = patch.pricePaise;
      if (patch.isVeg !== undefined) changes.isVeg = patch.isVeg;
      if (patch.isAvailable !== undefined) changes.isAvailable = patch.isAvailable;
      if (patch.imageKey !== undefined) changes.imageKey = patch.imageKey;
      if (patch.categoryId !== undefined && patch.categoryId !== before.categoryId) {
        await this.liveCategory(tx, stallId, patch.categoryId);
        changes.categoryId = patch.categoryId;
        changes.sortOrder = await this.nextItemSort(tx, stallId, patch.categoryId);
      }
      if (Object.keys(changes).length === 0) return { row: before, oldImage: null };

      const [after] = await tx.update(menuItems).set(changes).where(eq(menuItems.id, itemId)).returning();
      // Price changes are audited (spec V5): who changed it, from what, to what.
      if (changes.pricePaise !== undefined && changes.pricePaise !== before.pricePaise) {
        await audit(tx, {
          actorId: actor.userId,
          action: 'menu.item.price_change',
          entity: 'menu_item',
          entityId: itemId,
          before: { pricePaise: before.pricePaise },
          after: { pricePaise: after!.pricePaise },
          ip: actor.ip,
          userAgent: actor.userAgent,
        });
      }
      const replaced =
        changes.imageKey !== undefined && before.imageKey && before.imageKey !== changes.imageKey;
      return { row: after!, oldImage: replaced ? before.imageKey : null };
    });
    if (oldImage) await this.removeImage(oldImage);
    return this.toItem(row);
  }

  /** Soft delete: past orders keep pointing at the dish. */
  async deleteItem(stallId: string, itemId: string, actor: Actor, now: Date) {
    const removed = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(menuItems)
        .set({ deletedAt: now })
        .where(and(eq(menuItems.id, itemId), live.item(stallId)))
        .returning();
      if (!row) throw notFound('Dish not found');
      await audit(tx, {
        actorId: actor.userId,
        action: 'menu.item.delete',
        entity: 'menu_item',
        entityId: itemId,
        before: { stallId, name: row.name, pricePaise: row.pricePaise },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      return row;
    });
    if (removed.imageKey) await this.removeImage(removed.imageKey);
  }

  async reorderItems(stallId: string, categoryId: string, ids: string[]) {
    await this.liveCategory(this.db, stallId, categoryId);
    const current = await this.db
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(and(eq(menuItems.categoryId, categoryId), live.item(stallId)));
    assertSameSet(
      current.map((i) => i.id),
      ids,
      'dishes in this category',
    );
    await this.db.execute(sql`
      update ${menuItems} i set sort_order = v.ord - 1
      from unnest(${toUuidArray(ids)}) with ordinality as v(id, ord)
      where i.id = v.id and i.stall_id = ${stallId}`);
  }

  /** "Mark all available" (or sold out); limited to `itemIds` when given. Returns how many changed. */
  async setAvailability(stallId: string, available: boolean, itemIds?: string[]): Promise<number> {
    const rows = await this.db
      .update(menuItems)
      .set({ isAvailable: available })
      .where(
        and(
          live.item(stallId),
          eq(menuItems.isAvailable, !available),
          itemIds ? inArray(menuItems.id, itemIds) : undefined,
        ),
      )
      .returning({ id: menuItems.id });
    return rows.length;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private checkImage(stallId: string, key: string) {
    return assertUploadedImage(this.storage, stallId, key, 'items');
  }

  /** Best effort: a leftover photo costs a few KB, a failed save would cost the vendor's edit. */
  private async removeImage(key: string) {
    await this.storage.delete(key).catch(() => {});
  }

  private async liveCategory(db: Db, stallId: string, categoryId: string) {
    const [category] = await db
      .select({ id: menuCategories.id })
      .from(menuCategories)
      .where(and(eq(menuCategories.id, categoryId), live.category(stallId)));
    if (!category) throw badRequest('Pick one of your categories');
  }

  private async nextItemSort(db: Db, stallId: string, categoryId: string) {
    const [{ last } = { last: null }] = await db
      .select({ last: max(menuItems.sortOrder) })
      .from(menuItems)
      .where(and(eq(menuItems.categoryId, categoryId), live.item(stallId)));
    return (last ?? -1) + 1;
  }

  private toItem(i: ItemRow): VendorMenuItem {
    return {
      id: i.id,
      categoryId: i.categoryId,
      name: i.name,
      description: i.description,
      pricePaise: i.pricePaise,
      isVeg: i.isVeg,
      imageKey: i.imageKey,
      imageUrl: i.imageKey ? this.imageUrl(i.imageKey) : null,
      isAvailable: i.isAvailable,
      sortOrder: i.sortOrder,
    };
  }
}

function assertSameSet(current: string[], given: string[], what: string) {
  const have = new Set(current);
  if (
    new Set(given).size !== given.length ||
    given.length !== have.size ||
    !given.every((id) => have.has(id))
  ) {
    throw conflict(`The list of ${what} changed; reload and try again`);
  }
}

function toUuidArray(ids: string[]) {
  return sql`${`{${ids.join(',')}}`}::uuid[]`;
}
