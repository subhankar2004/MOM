'use client';

import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { RouteStatusChip, StallStatusChip } from '@/components/admin/stall-chips';
import { ApiError } from '@/lib/api-client';
import {
  checklistDone,
  parseTags,
  useAdminStalls,
  useCreateStall,
  type AdminStallRow,
  type StallStatus,
} from '@/lib/admin-stalls';

const FILTERS: Array<{ value: StallStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Live' },
  { value: 'draft', label: 'Drafts' },
  { value: 'suspended', label: 'Suspended' },
];

/** All stalls with their go-live progress (spec §6.3 A3). */
export function StallsList() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StallStatus | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const stalls = useAdminStalls({ q, status });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Stalls</h1>
        <Button icon={<Plus size={18} aria-hidden />} onClick={() => setAdding(true)}>
          Add stall
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Search"
          leading={<Search size={18} aria-hidden />}
          placeholder="Stall name or web address"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-0 flex-1 basis-60"
        />
        <div
          role="radiogroup"
          aria-label="Status"
          className="flex gap-1 rounded-(--radius-control) bg-surface-2 p-1"
        >
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={status === f.value}
              onClick={() => setStatus(f.value)}
              className={
                status === f.value
                  ? 'min-h-10 rounded-(--radius-control) bg-surface px-3 text-sm font-semibold shadow-sm'
                  : 'min-h-10 rounded-(--radius-control) px-3 text-sm font-semibold text-ink-muted hover:text-ink'
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {stalls.isPending ? (
        <Skeleton className="h-64" />
      ) : stalls.isError ? (
        <EmptyState
          title="Can't load stalls"
          description="Check your internet connection, then try again."
          action={<Button onClick={() => stalls.refetch()}>Try again</Button>}
        />
      ) : (
        <DataTable<AdminStallRow>
          caption="Stalls"
          rows={stalls.data}
          rowKey={(s) => s.id}
          empty={q || status !== 'all' ? 'No stalls match.' : 'No stalls yet. Add the first one.'}
          columns={[
            {
              key: 'name',
              header: 'Stall',
              cell: (s) => (
                <Link
                  href={`/admin/stalls/${s.id}`}
                  className="font-semibold text-brand underline-offset-2 hover:underline dark:text-ink"
                >
                  {s.name}
                  {s.location && (
                    <span className="block text-xs font-normal text-ink-muted">{s.location}</span>
                  )}
                </Link>
              ),
            },
            { key: 'status', header: 'Status', cell: (s) => <StallStatusChip status={s.status} /> },
            {
              key: 'ready',
              header: 'Ready to go live',
              cell: (s) => <span className="tabular">{checklistDone(s.checklist)} of 5</span>,
            },
            { key: 'upi', header: 'UPI payouts', cell: (s) => <RouteStatusChip status={s.routeStatus} /> },
          ]}
        />
      )}

      <AddStallSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddStallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Add a stall">
      {open && <AddStallForm onDone={onClose} />}
    </Sheet>
  );
}

function AddStallForm({ onDone }: { onDone: () => void }) {
  const create = useCreateStall();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | undefined>();

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length < 2) {
          setError('Give the stall a name (at least 2 characters)');
          return;
        }
        create.mutate(
          { name: name.trim(), location: location.trim() || null, cuisineTags: parseTags(tags) },
          {
            onSuccess: ({ id }) => {
              toast(`${name.trim()} added as a draft`, 'success');
              onDone();
              router.push(`/admin/stalls/${id}`);
            },
            onError: (err) =>
              setError(err instanceof ApiError ? err.message : 'That didn’t save. Try again.'),
          },
        );
      }}
    >
      <TextField
        label="Stall name"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        error={error}
        autoComplete="off"
      />
      <TextField
        label="Where is it?"
        hint="For example: Near the library gate"
        value={location}
        maxLength={120}
        onChange={(e) => setLocation(e.target.value)}
      />
      <TextField
        label="Food types"
        hint="Comma separated, e.g. Dosa, South Indian"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <p className="text-sm text-ink-muted">
        New stalls start as drafts: students can&apos;t see them until you make them live.
      </p>
      <Button type="submit" size="lg" fullWidth loading={create.isPending}>
        Add stall
      </Button>
    </form>
  );
}
