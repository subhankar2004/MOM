import type { Metadata } from 'next';
import { LoginPage } from '@/components/auth/login-page';

export const metadata: Metadata = { title: 'Stall console sign in', robots: { index: false } };

/** Stall owners and counter staff: only numbers MOM registered to a stall get in. */
export default function Page() {
  return <LoginPage portal="vendor" />;
}
