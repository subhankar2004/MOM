'use client';

import { formatINR } from '@mom/shared';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { OrderStatusChip } from '@/components/order/order-status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import {
  ROLE_LABEL,
  useAdminUser,
  userActions,
  useUserAction,
  type AdminUserDetail,
} from '@/lib/admin-console';
import { formatDateTime } from '@/lib/time';

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'That didn’t go through. Check your connection and try again.';

/** One user: who they are, what they can do, their orders, and admin actions (spec A4). */
export function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const query = useAdminUser(id);
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <EmptyState
        as="h1"
        title={missing ? 'User not found' : "Can't load this user"}
        description={
          missing ? 'The account may have been deleted.' : 'Check your internet connection, then try again.'
        }
        action={
          missing ? (
            <Link href="/admin/users" className="font-semibold underline">
              All users
            </Link>
          ) : (
            <Button onClick={() => query.refetch()}>Try again</Button>
          )
        }
      />
    );
  }
  return <Detail data={query.data} />;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function Detail({ data }: { data: AdminUserDetail }) {
  const { user } = data;
  const toast = useToast();
  const suspend = useUserAction(user.id, (suspended: boolean) => userActions.suspend(user.id, suspended));
  const signOut = useUserAction(user.id, () => userActions.signOut(user.id));
  const resetStrikes = useUserAction(user.id, () => userActions.resetStrikes(user.id));
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [adminSheet, setAdminSheet] = useState(false);
  const isAdmin = user.role === 'super_admin';
  const done = (message: string) => ({
    onSuccess: () => toast(message, 'success'),
    onError: (err: unknown) => toast(errorText(err), 'error'),
  });

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/users"
        className="flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden /> All users
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-3xl font-bold">{user.name ?? 'No name yet'}</h1>
        {user.status === 'suspended' ? (
          <StatusChip tone="danger">Suspended</StatusChip>
        ) : (
          <StatusChip tone="success">Active</StatusChip>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4 p-4">
          <dl className="grid grid-cols-2 gap-4">
            <Fact label="Phone">
              <span className="tabular">{user.phone ?? '—'}</span>
            </Fact>
            <Fact label="Role">{ROLE_LABEL[user.role]}</Fact>
            <Fact label="Joined">{formatDateTime(new Date(user.createdAt))}</Fact>
            <Fact label="Signed in on">
              {data.activeSessions === 1 ? '1 device' : `${data.activeSessions} devices`}
            </Fact>
            <Fact label="Cash no-show strikes">
              <span className="tabular">{user.cashStrikes}</span>
            </Fact>
          </dl>
          {data.memberships.length > 0 && (
            <div>
              <h2 className="text-sm text-ink-muted">Manages</h2>
              <ul className="mt-1 flex flex-col gap-1">
                {data.memberships.map((m) => (
                  <li key={m.stallId}>
                    <Link
                      href={`/admin/stalls/${m.stallId}`}
                      className="font-semibold underline-offset-2 hover:underline"
                    >
                      {m.stallName}
                    </Link>{' '}
                    <span className="text-sm text-ink-muted">
                      ({m.role === 'owner' ? 'owner' : 'counter staff'})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="font-display text-xl font-bold">Actions</h2>
          {user.status === 'active' ? (
            confirmSuspend ? (
              <div className="flex flex-col gap-2 rounded-(--radius-control) bg-danger-soft p-3">
                <p className="text-sm">
                  They&apos;re signed out on every device (open pages stop within 15 minutes) and can&apos;t
                  sign in until reactivated.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    loading={suspend.isPending}
                    onClick={() =>
                      suspend.mutate(true, {
                        ...done('Account suspended'),
                        onSettled: () => setConfirmSuspend(false),
                      })
                    }
                  >
                    Suspend account
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmSuspend(false)}>
                    Keep active
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmSuspend(true)}>
                Suspend…
              </Button>
            )
          ) : (
            <Button
              loading={suspend.isPending}
              onClick={() => suspend.mutate(false, done('Account reactivated'))}
            >
              Reactivate account
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={data.activeSessions === 0}
            loading={signOut.isPending}
            onClick={() => signOut.mutate(undefined, done('Signed out everywhere'))}
          >
            Sign out everywhere
          </Button>
          {user.cashStrikes > 0 && (
            <Button
              variant="secondary"
              loading={resetStrikes.isPending}
              onClick={() => resetStrikes.mutate(undefined, done('Cash strikes reset'))}
            >
              Reset cash strikes
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<ShieldAlert size={18} aria-hidden />}
            onClick={() => setAdminSheet(true)}
          >
            {isAdmin ? 'Remove super admin…' : 'Make super admin…'}
          </Button>
          {data.superAdminFromSettings && (
            <p className="text-sm text-ink-muted">
              This number is in the server setting SUPER_ADMIN_PHONES, so it is always made super admin at
              sign-in.
            </p>
          )}
          <p className="text-sm text-ink-muted">
            Every action here is recorded in the audit log under your name.
          </p>
        </Card>
      </div>

      <section aria-label="Recent orders" className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-bold">Recent orders</h2>
        <DataTable
          caption="Recent orders"
          rows={data.recentOrders}
          rowKey={(o) => o.id}
          empty="No orders yet."
          columns={[
            {
              key: 'when',
              header: 'When',
              cell: (o) => (
                <Link
                  href={`/admin/orders/${o.id}`}
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  {formatDateTime(new Date(o.createdAt))}
                </Link>
              ),
            },
            { key: 'stall', header: 'Stall', cell: (o) => o.stallName },
            { key: 'token', header: 'Token', cell: (o) => (o.tokenNo ? `#${o.tokenNo}` : '—') },
            { key: 'status', header: 'Status', cell: (o) => <OrderStatusChip status={o.status} /> },
            {
              key: 'total',
              header: 'Total',
              align: 'right',
              cell: (o) => <span className="tabular">{formatINR(o.totalPaise)}</span>,
            },
          ]}
        />
      </section>

      <SuperAdminSheet
        open={adminSheet}
        onClose={() => setAdminSheet(false)}
        userId={user.id}
        name={user.name ?? user.phone ?? 'this person'}
        grant={!isAdmin}
      />
    </div>
  );
}

/** Typed confirmation: the last 4 digits of their phone, so the wrong person is never changed. */
function SuperAdminSheet({
  open,
  onClose,
  userId,
  name,
  grant,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  name: string;
  grant: boolean;
}) {
  const action = useUserAction(userId, (last4: string) => userActions.superAdmin(userId, grant, last4));
  const toast = useToast();
  const [last4, setLast4] = useState('');
  const [error, setError] = useState<string>();
  return (
    <Sheet open={open} onClose={onClose} title={grant ? 'Make super admin?' : 'Remove super admin?'}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          action.mutate(last4, {
            onSuccess: () => {
              toast(grant ? `${name} is now a super admin` : `${name} is no longer a super admin`, 'success');
              setLast4('');
              onClose();
            },
            onError: (err) => setError(errorText(err)),
          });
        }}
      >
        <p>
          {grant
            ? `${name} will be able to see every order, change any stall and manage all users.`
            : `${name} loses admin access at once and is signed out everywhere. MOM always keeps at least one super admin.`}
        </p>
        <TextField
          label="Type the last 4 digits of their phone number"
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))}
          error={error}
        />
        <Button
          type="submit"
          variant={grant ? 'primary' : 'danger'}
          size="lg"
          fullWidth
          disabled={last4.length !== 4}
          loading={action.isPending}
        >
          {grant ? 'Make super admin' : 'Remove super admin'}
        </Button>
      </form>
    </Sheet>
  );
}
