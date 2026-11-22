import type { Metadata } from 'next';
import { LoginPage } from '@/components/auth/login-page';

export const metadata: Metadata = { title: 'MOM admin sign in', robots: { index: false } };

/** The MOM team: only super admins get in. */
export default function Page() {
  return <LoginPage portal="admin" />;
}
