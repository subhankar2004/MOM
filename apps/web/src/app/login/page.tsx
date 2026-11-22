import type { Metadata } from 'next';
import { LoginPage } from '@/components/auth/login-page';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

/** Students: anyone can sign in or sign up here. */
export default function Page() {
  return <LoginPage portal="student" />;
}
