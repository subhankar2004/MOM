// POST { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Called by the client right after Razorpay Checkout succeeds.
// The HMAC signature (made with our secret) is the proof of payment, so
// no user session is required. On success the order gets its token number.
import { adminClient, corsHeaders, env, hmacSha256Hex, json, safeEqual } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json({ error: "Missing payment fields" }, 400);
    }

    const expected = await hmacSha256Hex(
      env("RAZORPAY_KEY_SECRET"),
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );
    if (!safeEqual(expected, String(razorpay_signature))) {
      return json({ error: "Payment signature mismatch" }, 400);
    }

    const { data, error } = await adminClient().rpc("confirm_online_payment", {
      p_razorpay_order_id: razorpay_order_id,
      p_razorpay_payment_id: razorpay_payment_id,
    });
    if (error) throw error;

    return json({ order_id: data.id, token_no: data.token_no, status: data.status });
  } catch (e) {
    console.error(e);
    return json({ error: "Could not confirm payment" }, 500);
  }
});
