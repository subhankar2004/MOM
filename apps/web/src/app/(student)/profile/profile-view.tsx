'use client';

import type { MeResponse } from '@mom/shared';
import { useMutation } from '@tanstack/react-query';
import { LogOut, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { useSession, useSetSessionUser, useSignOut } from '@/lib/session';

const ROLE_LABEL = {
  student: 'Student',
  vendor_owner: 'Stall owner',
  vendor_staff: 'Stall staff',
  super_admin: 'MOM admin',
} as const;

export function ProfileView() {
  const { user } = useSession();
  const setSessionUser = useSetSessionUser();
  const signOut = useSignOut();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveName = useMutation({
    mutationFn: () => apiRequest<MeResponse>('/v1/me', { method: 'PATCH', body: { name } }),
    onSuccess: ({ user: updated }) => {
      setSessionUser(updated);
      toast('Name saved', 'success');
    },
  });

  const deleteAccount = useMutation({
    mutationFn: () => apiRequest<null>('/v1/me', { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => {
      setConfirmDelete(false);
      signOut.mutate(); // server already ended the sessions; this resets the app
      toast('Your account was deleted', 'success');
    },
  });

  if (!user) return null;
  const nameError =
    saveName.error instanceof ApiError
      ? ((saveName.error.details as Array<{ message: string }> | undefined)?.[0]?.message ??
        saveName.error.message)
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-black">Profile</h1>

      <Card className="flex flex-col gap-4 p-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            saveName.mutate();
          }}
        >
          <TextField
            label="Name"
            hint="The stall calls this out when your food is ready."
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoComplete="name"
            error={nameError}
          />
          <Button
            type="submit"
            variant="secondary"
            className="self-start"
            loading={saveName.isPending}
            disabled={!name.trim() || name.trim() === user.name}
          >
            Save name
          </Button>
        </form>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-border pt-4 text-sm">
          <dt className="text-ink-muted">Mobile</dt>
          <dd className="tabular font-semibold">{user.phone}</dd>
          <dt className="text-ink-muted">Account</dt>
          <dd className="font-semibold">{ROLE_LABEL[user.role]}</dd>
        </dl>
      </Card>

      <Button
        variant="secondary"
        icon={<LogOut size={18} aria-hidden />}
        loading={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        Sign out
      </Button>

      <section aria-labelledby="danger" className="flex flex-col gap-2 border-t border-border pt-6">
        <h2 id="danger" className="font-display text-xl font-bold">
          Delete account
        </h2>
        <p className="text-sm text-ink-muted">
          Removes your name and number from MOM. Past orders stay with the stalls for their accounts, without
          your details.
        </p>
        <Button
          variant="ghost"
          className="self-start text-danger"
          icon={<Trash2 size={18} aria-hidden />}
          onClick={() => setConfirmDelete(true)}
        >
          Delete my account
        </Button>
      </section>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete your account?">
        <div className="flex flex-col gap-4">
          <p>This can&apos;t be undone. You can sign up again later with the same number as a new account.</p>
          {deleteAccount.isError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {deleteAccount.error instanceof ApiError
                ? deleteAccount.error.message
                : 'Something went wrong.'}
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="danger" loading={deleteAccount.isPending} onClick={() => deleteAccount.mutate()}>
              Delete account
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep account
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
