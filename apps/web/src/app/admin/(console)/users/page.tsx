import type { Metadata } from 'next';
import { UsersList } from './users-list';

export const metadata: Metadata = { title: 'Users' };

export default function Page() {
  return <UsersList />;
}
