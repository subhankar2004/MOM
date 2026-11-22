'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectField } from '@/components/ui/select-field';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { TextField } from '@/components/ui/text-field';
import {
  ROLE_LABEL,
  useAdminUsers,
  type AdminUserRow,
  type UserRole,
  type UserStatus,
} from '@/lib/admin-console';
import { formatDateTime } from '@/lib/time';

/** Users & access (spec §6.3 A4): search by phone or name, filter by role or status. */
export function UsersList() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const deferredQ = useDeferredValue(q);
  const users = useAdminUsers({ q: deferredQ, role, status });
  const rows = users.data?.pages.flatMap((p) => p.users) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-bold">Users &amp; access</h1>
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Search"
          leading={<Search size={18} aria-hidden />}
          placeholder="Name or phone number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-0 flex-1 basis-60"
        />
        <SelectField
          label="Role"
          value={role}
          onChange={setRole}
          options={[
            { value: '', label: 'Everyone' },
            ...(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] })),
          ]}
        />
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'Any' },
            { value: 'active', label: 'Active' },
            { value: 'suspended', label: 'Suspended' },
          ]}
        />
      </div>

      {users.isPending ? (
        <Skeleton className="h-64" />
      ) : users.isError ? (
        <EmptyState
          title="Can't load users"
          description="Check your internet connection, then try again."
          action={<Button onClick={() => users.refetch()}>Try again</Button>}
        />
      ) : (
        <>
          <DataTable<AdminUserRow>
            caption="Users"
            rows={rows}
            rowKey={(u) => u.id}
            empty="No users match."
            columns={[
              {
                key: 'name',
                header: 'User',
                cell: (u) => (
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="font-semibold text-brand underline-offset-2 hover:underline dark:text-ink"
                  >
                    {u.name ?? 'No name yet'}
                    <span className="tabular block text-xs font-normal text-ink-muted">{u.phone}</span>
                  </Link>
                ),
              },
              { key: 'role', header: 'Role', cell: (u) => ROLE_LABEL[u.role] },
              {
                key: 'status',
                header: 'Status',
                cell: (u) =>
                  u.status === 'suspended' ? (
                    <StatusChip tone="danger">Suspended</StatusChip>
                  ) : (
                    <StatusChip tone="success">Active</StatusChip>
                  ),
              },
              {
                key: 'orders',
                header: 'Orders',
                align: 'right',
                cell: (u) => <span className="tabular">{u.orders}</span>,
              },
              {
                key: 'joined',
                header: 'Joined',
                cell: (u) => <span className="text-ink-muted">{formatDateTime(new Date(u.createdAt))}</span>,
              },
            ]}
          />
          {users.hasNextPage && (
            <Button
              variant="secondary"
              className="self-center"
              loading={users.isFetchingNextPage}
              onClick={() => users.fetchNextPage()}
            >
              Show more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
