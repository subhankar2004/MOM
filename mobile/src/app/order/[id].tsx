import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Button, Card, ErrorText, Loading, StatusPill, Txt } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { PAYMENT_LABEL, inr } from '@/lib/money';
import { payForOrder } from '@/lib/payments';
import { errorMessage, supabase } from '@/lib/supabase';
import { useColors } from '@/lib/theme';
import type { Order, OrderStatus } from '@/lib/types';

const STEPS: OrderStatus[] = ['placed', 'preparing', 'ready', 'completed'];
const STEP_LABELS = ['Placed', 'Preparing', 'Ready', 'Collected'];

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { session, profile } = useAuth();
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, stalls(name, location), order_items(*)')
      .eq('id', id)
      .maybeSingle();
    if (error) setError(errorMessage(error));
    setOrder(data as Order | null);
  }, [id]);

  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    const ch = supabase
      .channel(`order-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, load, session]);

  async function payNow() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await payForOrder(order.id, profile?.email);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (!order) return;
    Alert.alert('Cancel this order?', undefined, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('cancel_my_order', { p_order_id: order.id });
          if (error) setError(errorMessage(error));
          load();
        },
      },
    ]);
  }

  if (order === undefined) return <Loading />;
  if (order === null) return <ErrorText message={error ?? 'Order not found'} />;

  const step = STEPS.indexOf(order.status);
  const ready = order.status === 'ready';

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
      <Card style={{ padding: 24, alignItems: 'center', gap: 6, ...(ready ? { borderColor: c.green, borderWidth: 3 } : {}) }}>
        {order.token_no ? (
          <>
            <Txt muted weight="700" size={12} style={{ letterSpacing: 2 }}>
              YOUR TOKEN
            </Txt>
            <Txt size={72} weight="900" color={c.brand}>
              #{order.token_no}
            </Txt>
            <Txt weight="700">{order.stalls?.name}</Txt>
            <Txt muted size={13}>
              📍 {order.stalls?.location}
            </Txt>
          </>
        ) : (
          <>
            <Txt weight="800" size={18} style={{ textAlign: 'center' }}>
              {order.status === 'cancelled' ? 'Order cancelled' : 'Complete payment to get your token'}
            </Txt>
            <Txt muted>{order.stalls?.name}</Txt>
          </>
        )}
        <View style={{ marginTop: 8 }}>
          <StatusPill status={order.status} />
        </View>
        {ready && (
          <Txt weight="700" color={c.green} style={{ textAlign: 'center', marginTop: 6 }}>
            Your food is ready! Show token #{order.token_no} at the counter.
          </Txt>
        )}
      </Card>

      {step >= 0 && (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {STEPS.map((s, i) => (
            <View key={s} style={{ flex: 1, gap: 4, alignItems: 'center' }}>
              <View style={{ height: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: i <= step ? c.brand : c.border }} />
              <Txt size={11} weight={i <= step ? '700' : '400'} muted={i > step}>
                {STEP_LABELS[i]}
              </Txt>
            </View>
          ))}
        </View>
      )}

      <ErrorText message={error} />
      {order.status === 'pending_payment' && (
        <Button disabled={busy} onPress={payNow} title={busy ? 'Opening payment…' : `Pay ${inr(order.total_paise)} now`} />
      )}

      <Card style={{ padding: 14, gap: 6 }}>
        {order.order_items?.map((i) => (
          <View key={i.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt>
              {i.quantity} × {i.name}
            </Txt>
            <Txt>{inr(i.line_total_paise)}</Txt>
          </View>
        ))}
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6, gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt muted>Item total</Txt>
            <Txt muted>{inr(order.subtotal_paise)}</Txt>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt muted>
              {order.payment_mode === 'online' ? 'Convenience fee' : 'Pay-at-counter charge'} ({Number(order.fee_percent)}%)
            </Txt>
            <Txt muted>{inr(order.fee_paise)}</Txt>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt weight="800">Total</Txt>
            <Txt weight="800">{inr(order.total_paise)}</Txt>
          </View>
        </View>
        <Txt muted size={12}>
          {order.payment_mode === 'online' ? 'Online' : 'At counter'} · {PAYMENT_LABEL[order.payment_status]}
          {order.note ? ` · Note: “${order.note}”` : ''}
        </Txt>
      </Card>

      {(order.status === 'pending_payment' || (order.status === 'placed' && order.payment_status === 'pay_at_counter')) && (
        <Pressable onPress={cancel} style={{ alignItems: 'center', padding: 8 }}>
          <Txt color={c.red} style={{ textDecorationLine: 'underline' }}>
            Cancel order
          </Txt>
        </Pressable>
      )}
    </ScrollView>
  );
}
