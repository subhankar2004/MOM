import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, publicId, updatedAt } from './_common.js';
import { stalls } from './stalls.js';

export const menuCategories = pgTable(
  'menu_categories',
  {
    id: publicId(),
    stallId: uuid()
      .notNull()
      .references(() => stalls.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('menu_categories_name_length', sql`char_length(${t.name}) between 1 and 40`),
    // Target for menu_items' composite FK: guarantees an item's category belongs to the same stall.
    unique('menu_categories_id_stall_unique').on(t.id, t.stallId),
    uniqueIndex('menu_categories_stall_name_unique')
      .on(t.stallId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index('menu_categories_stall_sort_idx').on(t.stallId, t.sortOrder),
  ],
);

export const menuItems = pgTable(
  'menu_items',
  {
    id: publicId(),
    stallId: uuid()
      .notNull()
      .references(() => stalls.id, { onDelete: 'cascade' }),
    categoryId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    pricePaise: integer().notNull(),
    isVeg: boolean().notNull(),
    /** S3 object key of the item photo. */
    imageKey: text(),
    isAvailable: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Soft delete: old orders keep pointing at the item. */
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'menu_items_category_same_stall_fk',
      columns: [t.categoryId, t.stallId],
      foreignColumns: [menuCategories.id, menuCategories.stallId],
    }),
    check('menu_items_name_length', sql`char_length(${t.name}) between 1 and 80`),
    check('menu_items_description_length', sql`char_length(${t.description}) <= 300`),
    // ₹1 to ₹10,000 per item
    check('menu_items_price_range', sql`${t.pricePaise} between 100 and 1000000`),
    index('menu_items_menu_idx')
      .on(t.stallId, t.categoryId, t.sortOrder)
      .where(sql`${t.deletedAt} is null`),
    index('menu_items_category_idx').on(t.categoryId, t.stallId),
  ],
);
