import Link from 'next/link';
import { Suspense } from 'react';
import { Logo } from '@/components/ui/logo';
import { Spinner } from '@/components/ui/spinner';
import { LoginFlow, type Portal } from './login-flow';

/** The sign-in page shell, shared by the student, stall and admin sign-in pages. */
export function LoginPage({ portal }: { portal: Portal }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-4 py-8">
      <Link href="/" aria-label="MOM home" className="self-start">
        <Logo />
      </Link>
      <div className="flex flex-1 flex-col justify-center py-8">
        {/* The flow reads ?next= from the URL, so it renders in the browser (Next 16 Suspense rule). */}
        <Suspense
          fallback={
            <div className="flex justify-center">
              <Spinner size={28} label="Loading" />
            </div>
          }
        >
          <LoginFlow portal={portal} />
        </Suspense>
      </div>
      <p className="text-center text-sm text-ink-muted">
        By signing in you agree to MOM&apos;s terms and privacy policy.
      </p>
    </main>
  );
}
