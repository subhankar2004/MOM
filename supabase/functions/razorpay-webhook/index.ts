// Razorpay → us. Backup path that confirms payments even if the student
// closed the app before the client-side verify call finished.
// Configure in Razorpay Dashboard → Webhooks, events: payment.captured, order.paid
import { adminClient, env, hmacSha256Hex, json, safeEqual } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const expected = await hmacSha256Hex(env("RAZORPAY_WEBHOOK_SECRET"), raw);
  if (!safeEqual(expected, signature)) return json({ error: "Bad signature" }, 400);

  const event = JSON.parse(raw);
  if (event.event !== "payment.captured" && event.event !== "order.paid") {
    return json({ ignored: event.event });
  }

  const payment = event.payload?.payment?.entity;
  if (!payment?.order_id || !payment?.id) return json({ ignored: "no payment entity" });

  const { error } = await adminClient().rpc("confirm_online_payment", {
    p_razorpay_order_id: payment.order_id,
    p_razorpay_payment_id: payment.id,
  });
  if (error) {
    console.error(error);
    // 2xx for orders we don't know (e.g. test events) so Razorpay stops retrying.
    if (error.code === "P0002") return json({ ignored: "unknown order" });
    return json({ error: "confirm failed" }, 500);
  }
  return json({ ok: true });
});
