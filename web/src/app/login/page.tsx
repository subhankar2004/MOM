"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorBox } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const { session, profile, refreshProfile } = useAuth();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "name">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in → ask for a name once, then continue.
  useEffect(() => {
    if (!session || !profile) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- step follows auth state
    if (!profile.full_name) setStep("name");
    else router.replace(next);
  }, [session, profile, next, router]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setError(errorMessage(error));
    // The effect above handles the redirect once the profile loads.
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", session.user.id);
    setBusy(false);
    if (error) return setError(errorMessage(error));
    await refreshProfile();
  }

  return (
    <div className="mx-auto max-w-sm py-8">
      <div className="card p-6">
        <h1 className="text-2xl font-extrabold">
          {step === "name" ? "One last thing" : "Sign in to MOM"}
        </h1>

        {step === "email" && (
          <form onSubmit={sendCode} className="mt-5 space-y-3">
            <p className="text-sm text-muted">We’ll email you a 6-digit code. No password needed.</p>
            <input
              className="input"
              type="email"
              required
              autoFocus
              placeholder="you@vssut.ac.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <ErrorBox message={error} />
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verify} className="mt-5 space-y-3">
            <p className="text-sm text-muted">
              Enter the code sent to <b>{email}</b>.
            </p>
            <input
              className="input text-center font-mono text-2xl tracking-[0.5em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <ErrorBox message={error} />
            <button className="btn-primary w-full" disabled={busy || code.length < 6}>
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
            <button type="button" className="w-full text-sm text-muted underline" onClick={() => setStep("email")}>
              Use a different email
            </button>
          </form>
        )}

        {step === "name" && (
          <form onSubmit={saveName} className="mt-5 space-y-3">
            <p className="text-sm text-muted">What should the stall call out when your order is ready?</p>
            <input
              className="input"
              required
              autoFocus
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <ErrorBox message={error} />
            <button className="btn-primary w-full" disabled={busy || !name.trim()}>
              Continue
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
