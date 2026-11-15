"use client";

/**
 * Hosted Razorpay checkout for the MOM mobile app.
 *
 * The app creates the Razorpay order itself (via the create-payment Edge
 * Function, using the student's session), then opens this page in an
 * in-app browser with the checkout params in the query string. Razorpay's
 * signature is verified server-side by verify-payment, and we redirect back
 * to the app's deep link with the result.
 */
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { inr } from "@/lib/money";
import { errorMessage } from "@/lib/supabase";
import { openCheckout } from "@/lib/razorpay";

export default function PayPage() {
  const q = useSearchParams();
  const [state, setState] = useState<"ready" | "paying" | "done" | "error">("ready");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  const returnUrl = q.get("return") ?? "";
  const amount = Number(q.get("amount") ?? 0);
  // Only ever redirect to our own app scheme.
  const safeReturn = /^mom:\/\//.test(returnUrl) || /^exp(s)?:\/\//.test(returnUrl) ? returnUrl : null;

  function back(status: "success" | "cancelled", extra = "") {
    // Deep link back into the native app (not an internal Next.js route).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (safeReturn) location.href = `${safeReturn}${safeReturn.includes("?") ? "&" : "?"}status=${status}${extra}`;
  }

  async function pay() {
    setState("paying");
    try {
      const res = await openCheckout({
        key_id: q.get("key") ?? "",
        razorpay_order_id: q.get("rzp_order") ?? "",
        amount,
        currency: "INR",
        description: q.get("desc") ?? "MOM order",
        prefill: { email: q.get("email") ?? undefined },
      });
      setState("done");
      back("success", `&token=${res.token_no}`);
    } catch (e) {
      setMessage(errorMessage(e));
      setState("error");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    pay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-sm py-10 text-center">
      <div className="card space-y-4 p-6">
        <p className="text-sm text-muted">Paying</p>
        <p className="text-4xl font-black">{inr(amount)}</p>
        {state === "paying" && <p className="text-sm">Opening Razorpay…</p>}
        {state === "done" && <p className="font-semibold text-green-700">Payment successful! Returning to the app…</p>}
        {state === "error" && (
          <>
            <p className="text-sm text-red-600">{message}</p>
            <button className="btn-primary w-full" onClick={pay}>
              Try again
            </button>
            <button className="btn-ghost w-full" onClick={() => back("cancelled")}>
              Back to app
            </button>
          </>
        )}
      </div>
    </div>
  );
}
