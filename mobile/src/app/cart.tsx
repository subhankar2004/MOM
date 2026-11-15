import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Button, Card, ErrorText, Txt, VegDot } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { DEFAULT_FEES, feePreview, inr } from '@/lib/money';
import { payForOrder } from '@/lib/payments';
import { errorMessage, supabase } from '@/lib/supabase';
import { useColors } from '@/lib/theme';
import type { Order, PaymentMode, PlatformSettings } from '@/lib/types';

export default function CartScreen() {
  const c = useColors();
  const cart = useCart();
  const { session, profile } = useAuth();
  const [mode, setMode] = useState<PaymentMode>('online');
  const [fees, setFees] = useState(DEFAULT_FEES);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('online_fee_percent, offline_fee_percent')
      .maybeSingle()
      .then(({ data }) => {
        const s = data as PlatformSettings | null;
        if (s) setFees({ online: Number(s.online_fee_percent), offline: Number(s.offline_fee_percent) });
      });
  }, []);

  if (cart.count === 0 || !cart.stall) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: c.bg }}>
        <Txt weight="700" size={18}>
          Your cart is empty
        </Txt>
        <Button title="Browse stalls" onPress={() => router.back()} />
      </View>
    );
  }

  const { fee, total } = feePreview(cart.subtotal, fees[mode]);
  const stall = cart.stall;

  async function placeOrder() {
    if (!session) return router.push('/login');
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc('place_order', {
        p_stall_id: stall.id,
        p_items: Object.values(cart.lines).map((l) => ({ menu_item_id: l.item.id, quantity: l.quantity })),
        p_payment_mode: mode,
        p_note: note || null,
      });
      if (error) throw error;
      const order = data as Order;
      cart.clear();
      if (mode === 'online') {
        try {
          await payForOrder(order.id, profile?.email);
        } catch (e) {
          setError(errorMessage(e));
        }
      }
      router.dismissAll();
      router.push(`/order/${order.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
      <Txt muted>
        From <Txt weight="700">{stall.name}</Txt>
      </Txt>

      <Card>
        {Object.values(cart.lines).map(({ item, quantity }, i) => (
          <View key={item.id} style={[styles.line, i > 0 && { borderTopWidth: 1, borderTopColor: c.border }]}>
            <VegDot veg={item.is_veg} />
            <View style={{ flex: 1 }}>
              <Txt weight="600">{item.name}</Txt>
              <Txt muted size={13}>
                {inr(item.price_paise)}
              </Txt>
            </View>
            <View style={[styles.stepper, { borderColor: c.brand }]}>
              <Pressable hitSlop={8} onPress={() => cart.remove(item.id)}>
                <Txt weight="800" size={18} color={c.brand}>
                  −
                </Txt>
              </Pressable>
              <Txt weight="800" color={c.brand}>
                {quantity}
              </Txt>
              <Pressable hitSlop={8} onPress={() => cart.add(stall, item)}>
                <Txt weight="800" size={18} color={c.brand}>
                  +
                </Txt>
              </Pressable>
            </View>
            <Txt weight="700" style={{ width: 64, textAlign: 'right' }}>
              {inr(item.price_paise * quantity)}
            </Txt>
          </View>
        ))}
      </Card>

      <TextInput
        placeholder="Note for the stall (less spicy, no onion…)"
        placeholderTextColor={c.muted}
        value={note}
        onChangeText={setNote}
        maxLength={200}
        style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
      />

      <Txt weight="800" size={16}>
        How do you want to pay?
      </Txt>
      <PayOption
        active={mode === 'online'}
        onPress={() => setMode('online')}
        title="Pay online now"
        subtitle={`UPI, cards, wallets · ${fees.online}% convenience fee`}
        badge="Cheapest"
      />
      <PayOption
        active={mode === 'offline'}
        onPress={() => setMode('offline')}
        title="Pay at the counter"
        subtitle={`Cash/UPI when you collect · ${fees.offline}% extra charge`}
      />

      <Card style={{ padding: 14, gap: 6 }}>
        <Row label="Item total" value={inr(cart.subtotal)} />
        <Row
          label={mode === 'online' ? `Convenience fee (${fees.online}%)` : `Pay-at-counter charge (${fees.offline}%)`}
          value={inr(fee)}
        />
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6 }}>
          <Row label="To pay" value={inr(total)} bold />
        </View>
      </Card>

      <ErrorText message={error} />
      <Button
        disabled={busy}
        onPress={placeOrder}
        title={
          busy
            ? 'Placing order…'
            : !session
              ? 'Sign in to order'
              : mode === 'online'
                ? `Pay ${inr(total)}`
                : `Place order · pay ${inr(total)} at counter`
        }
      />
    </ScrollView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Txt weight={bold ? '800' : '400'}>{label}</Txt>
      <Txt weight={bold ? '800' : '400'}>{value}</Txt>
    </View>
  );
}

function PayOption(props: { active: boolean; onPress: () => void; title: string; subtitle: string; badge?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={props.onPress}>
      <Card style={[styles.pay, props.active && { borderColor: c.brand, borderWidth: 2 }]}>
        <View style={[styles.radio, { borderColor: props.active ? c.brand : c.border }]}>
          {props.active && <View style={[styles.radioDot, { backgroundColor: c.brand }]} />}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Txt weight="700">{props.title}</Txt>
            {props.badge && (
              <Txt size={11} weight="700" color="#166534" style={styles.badge}>
                {props.badge}
              </Txt>
            )}
          </View>
          <Txt muted size={12}>
            {props.subtitle}
          </Txt>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15 },
  pay: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  badge: { backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
});
