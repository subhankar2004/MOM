'use client';

import { Search } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectField } from '@/components/ui/select-field';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { auditDiff, useAudit, type AuditEntry, type AuditFilter } from '@/lib/admin-platform';
import { formatDateTime } from '@/lib/time';

const EMPTY: AuditFilter = { actor: '', entity: '', entityId: '', action: '', from: '', to: '' };

const ENTITIES = [
  { value: '', label: 'Everything' },
  { value: 'order', label: 'Orders' },
  { value: 'user', label: 'Users' },
  { value: 'stall', label: 'Stalls' },
  { value: 'menu_item', label: 'Dishes' },
  { value: 'platform_settings', label: 'Platform settings' },
];

/** Where an entry's record lives in the admin console. */
function recordLink(e: AuditEntry): Route | null {
  if (!e.entityId) return null;
  if (e.entity === 'order') return `/admin/orders/${e.entityId}` as Route;
  if (e.entity === 'user') return `/admin/users/${e.entityId}` as Route;
  if (e.entity === 'stall') return `/admin/stalls/${e.entityId}` as Route;
  return null;
}

/** The audit log (spec §6.3 A8): who changed what, before and after, when, from where. Read-only. */
export function AuditView() {
  const [filter, setFilter] = useState<AuditFilter>(EMPTY);
  const deferred = useDeferredValue(filter);
  const audit = useAudit(deferred);
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];
  const set = (k: keyof AuditFilter) => (v: string) => setFilter((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl font-bold">Audit log</h1>
        <p className="text-ink-muted">
          Every change by MOM admins, stall owners and the system. Entries can&apos;t be edited or deleted.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label="Who"
          leading={<Search size={18} aria-hidden />}
          placeholder="Name, phone, or “system”"
          value={filter.actor}
          onChange={(e) => set('actor')(e.target.value)}
        />
        <SelectField label="What" value={filter.entity} onChange={set('entity')} options={ENTITIES} />
        <TextField
          label="Action starts with"
          placeholder="e.g. order.refund"
          value={filter.action}
          onChange={(e) => set('action')(e.target.value)}
        />
        <TextField
          label="Record id"
          placeholder="Order, user or stall id"
          value={filter.entityId}
          onChange={(e) => set('entityId')(e.target.value.trim())}
        />
        <TextField
          label="From"
          type="date"
          value={filter.from}
          onChange={(e) => set('from')(e.target.value)}
        />
        <TextField label="To" type="date" value={filter.to} onChange={(e) => set('to')(e.target.value)} />
      </div>

      {audit.isPending ? (
        <Skeleton className="h-64" />
      ) : audit.isError ? (
        <EmptyState
          title="Can't load the audit log"
          description="Check the filters and your internet connection, then try again."
          action={<Button onClick={() => audit.refetch()}>Try again</Button>}
        />
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-ink-muted">No entries match.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border rounded-(--radius-card) border border-border bg-surface">
          {entries.map((e) => (
            <Entry key={e.id} e={e} />
          ))}
        </ol>
      )}
      {audit.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={audit.isFetchingNextPage}
          onClick={() => audit.fetchNextPage()}
        >
          Show older entries
        </Button>
      )}
    </div>
  );
}

function Entry({ e }: { e: AuditEntry }) {
  const diff = auditDiff(e.before, e.after);
  const link = recordLink(e);
  return (
    <li className="flex flex-col gap-1 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-semibold">
          <code className="text-sm">{e.action}</code>
          {e.entityId && (
            <span className="font-normal text-ink-muted">
              {' '}
              on{' '}
              {link ? (
                <Link href={link} className="underline-offset-2 hover:underline">
                  {e.entity} {e.entityId.slice(0, 8)}
                </Link>
              ) : (
                `${e.entity} ${e.entityId.slice(0, 8)}`
              )}
            </span>
          )}
        </p>
        <p className="text-sm text-ink-muted">{formatDateTime(new Date(e.createdAt))}</p>
      </div>
      <p className="text-sm">
        {e.actor ? (
          <Link href={`/admin/users/${e.actor.id}`} className="underline-offset-2 hover:underline">
            {e.actor.name ?? 'No name'} <span className="tabular text-ink-muted">{e.actor.phone}</span>
          </Link>
        ) : (
          <span className="text-ink-muted">System</span>
        )}
        {e.ip && <span className="text-ink-muted"> · {e.ip}</span>}
      </p>
      {diff.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
            Before and after ({diff.length} {diff.length === 1 ? 'field' : 'fields'})
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Field</th>
                  <th className="py-1 pr-3 font-medium">Before</th>
                  <th className="py-1 font-medium">After</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {diff.map((d) => (
                  <tr key={d.field} className="border-t border-border align-top">
                    <td className="py-1 pr-3 font-medium">{d.field}</td>
                    <td className="py-1 pr-3 break-all text-ink-muted">{d.before}</td>
                    <td className="py-1 break-all">{d.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </li>
  );
}
