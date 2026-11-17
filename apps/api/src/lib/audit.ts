import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema/index.js';

export interface AuditEntry {
  /** Who did it. null = the system (a background job, a bootstrap rule). */
  actorId: string | null;
  /** Verb-style name, e.g. "stall.member.add", "user.suspend". */
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

/**
 * Appends one row to the audit log (spec A8). The table is append-only at the database
 * level, so entries can't be edited or removed later. Call it inside the same transaction
 * as the change, so a change is never saved without its audit entry (or vice versa).
 */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip,
    userAgent: entry.userAgent?.slice(0, 300),
  });
}
