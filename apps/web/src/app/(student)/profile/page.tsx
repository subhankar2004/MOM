import type { Metadata } from 'next';
import { RequireRole } from '@/components/auth/require-role';
import { ProfileView } from './profile-view';

export const metadata: Metadata = { title: 'Profile' };

export default function ProfilePage() {
  return (
    <RequireRole area="student">
      <ProfileView />
    </RequireRole>
  );
}
