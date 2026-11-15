import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase, WEB_URL } from './supabase';

/**
 * Online payment from the app without a native Razorpay SDK (works in Expo Go):
 *  1. create-payment Edge Function (with the student's session) → Razorpay order
 *  2. open the web app's /pay page in an in-app browser; it runs Razorpay
 *     Checkout and verifies the signature server-side
 *  3. /pay redirects back to mom://order/<id>?status=success&token=N
 * The Razorpay webhook is a backup if the student closes the browser early.
 */
export async function payForOrder(orderId: string, email?: string | null) {
  if (!WEB_URL) throw new Error('EXPO_PUBLIC_WEB_URL is not set — online payment needs the web app URL.');

  const { data, error } = await supabase.functions.invoke('create-payment', { body: { order_id: orderId } });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? error.message);
  }

  const returnUrl = Linking.createURL(`order/${orderId}`);
  const qs = new URLSearchParams({
    key: data.key_id,
    rzp_order: data.razorpay_order_id,
    amount: String(data.amount),
    desc: data.description,
    return: returnUrl,
    ...(email ? { email } : {}),
  });

  const result = await WebBrowser.openAuthSessionAsync(`${WEB_URL}/pay?${qs}`, returnUrl);
  if (result.type !== 'success') return { status: 'cancelled' as const };

  const { queryParams } = Linking.parse(result.url);
  return {
    status: queryParams?.status === 'success' ? ('success' as const) : ('cancelled' as const),
    token: queryParams?.token ? Number(queryParams.token) : undefined,
  };
}
