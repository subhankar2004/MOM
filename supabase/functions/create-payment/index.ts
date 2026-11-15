// POST { order_id } → creates (or reuses) a Razorpay order for an online
// MOM order belonging to the signed-in user, and returns what the client
// needs to open Razorpay Checkout.
import { adminClient, callerId, corsHeaders, env, json } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { order_id } = await req.json();
    if (!order_id) return json({ error: "order_id is required" }, 400);

    const uid = await callerId(req);
    if (!uid) return json({ error: "Please sign in again" }, 401);

    const { data: order, error } = await adminClient()
      .from("orders")
      .select("id, user_id, status, payment_mode, total_paise, razorpay_order_id, stalls(name)")
      .eq("id", order_id)
      .maybeSingle();

    // Only the person who placed the order may pay for it.
    if (error || !order || order.user_id !== uid) return json({ error: "Order not found" }, 404);
    if (order.payment_mode !== "online" || order.status !== "pending_payment") {
      return json({ error: "This order is not awaiting online payment" }, 409);
    }

    const keyId = env("RAZORPAY_KEY_ID");
    let razorpayOrderId = order.razorpay_order_id as string | null;

    if (!razorpayOrderId) {
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + btoa(`${keyId}:${env("RAZORPAY_KEY_SECRET")}`),
        },
        body: JSON.stringify({
          amount: order.total_paise, // Razorpay expects paise
          currency: "INR",
          receipt: order.id,
          notes: { mom_order_id: order.id },
        }),
      });
      const rp = await res.json();
      if (!res.ok) {
        console.error("Razorpay order create failed", rp);
        return json({ error: rp?.error?.description ?? "Could not start payment" }, 502);
      }
      razorpayOrderId = rp.id as string;

      const { error: attachErr } = await adminClient().rpc("attach_razorpay_order", {
        p_order_id: order.id,
        p_razorpay_order_id: razorpayOrderId,
      });
      if (attachErr) throw attachErr;
    }

    // deno-lint-ignore no-explicit-any
    const stallName = (order as any).stalls?.name ?? "MOM";
    return json({
      key_id: keyId,
      razorpay_order_id: razorpayOrderId,
      amount: order.total_paise,
      currency: "INR",
      order_id: order.id,
      description: `Order at ${stallName}`,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
