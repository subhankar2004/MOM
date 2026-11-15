import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Switch, View } from 'react-native';
import { Card, ErrorText, Loading, Txt, VegDot } from '@/components/ui';
import { useCart } from '@/lib/cart';
import { inr } from '@/lib/money';
import { errorMessage, supabase } from '@/lib/supabase';
import { useColors } from '@/lib/theme';
import type { MenuItem, Stall } from '@/lib/types';

export default function StallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const cart = useCart();
  const [stall, setStall] = useState<Stall | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vegOnly, setVegOnly] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('stalls').select('*').eq('id', id).maybeSingle(),
      supabase.from('menu_items').select('*').eq('stall_id', id).order('sort_order').order('name'),
    ]).then(([s, m]) => {
      if (s.error || m.error) setError(errorMessage(s.error ?? m.error));
      setStall(s.data as Stall | null);
      setMenu((m.data as MenuItem[]) ?? []);
    });
  }, [id]);

  const sections = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of menu ?? []) {
      if (vegOnly && !item.is_veg) continue;
      groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    }
    return [...groups.entries()].map(([title, data]) => ({ title, data }));
  }, [menu, vegOnly]);

  if (!menu) return <Loading />;
  if (!stall) return <ErrorText message={error ?? 'Stall not found'} />;

  function add(item: MenuItem) {
    if (!stall) return;
    if (!cart.add(stall, item)) {
      Alert.alert('Start a new cart?', `Your cart has items from ${cart.stall?.name}.`, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Start new', style: 'destructive', onPress: () => cart.startNew(stall, item) },
      ]);
    }
  }

  const cartHere = cart.stall?.id === stall.id && cart.count > 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: stall.name }} />
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ gap: 4, marginBottom: 8 }}>
            <Txt muted>
              {stall.cuisine} · 📍 {stall.location} · ~{stall.avg_prep_mins} min
            </Txt>
            {stall.description ? <Txt>{stall.description}</Txt> : null}
            {!stall.is_open && (
              <Txt weight="600" style={{ backgroundColor: c.border, padding: 10, borderRadius: 10, marginTop: 8 }}>
                This stall is closed right now.
              </Txt>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Switch value={vegOnly} onValueChange={setVegOnly} trackColor={{ true: '#16a34a' }} />
              <VegDot veg />
              <Txt weight="600">Veg only</Txt>
            </View>
            <ErrorText message={error} />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Txt weight="800" size={18} style={{ marginTop: 16, marginBottom: 8 }}>
            {section.title}
          </Txt>
        )}
        renderItem={({ item }) => {
          const qty = cart.stall?.id === stall.id ? cart.quantityOf(item.id) : 0;
          const orderable = stall.is_open && item.is_available;
          return (
            <Card style={[styles.item, { opacity: item.is_available ? 1 : 0.5 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <VegDot veg={item.is_veg} />
                  <Txt weight="700">{item.name}</Txt>
                </View>
                <Txt weight="600">{inr(item.price_paise)}</Txt>
                {item.description ? <Txt muted size={12}>{item.description}</Txt> : null}
                {!item.is_available && (
                  <Txt size={12} weight="700" color={c.red}>
                    Sold out
                  </Txt>
                )}
              </View>
              {qty > 0 ? (
                <View style={[styles.stepper, { borderColor: c.brand }]}>
                  <Pressable hitSlop={8} onPress={() => cart.remove(item.id)}>
                    <Txt size={20} weight="800" color={c.brand}>
                      −
                    </Txt>
                  </Pressable>
                  <Txt weight="800" color={c.brand}>
                    {qty}
                  </Txt>
                  <Pressable hitSlop={8} disabled={!orderable} onPress={() => add(item)}>
                    <Txt size={20} weight="800" color={c.brand}>
                      +
                    </Txt>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  disabled={!orderable}
                  onPress={() => add(item)}
                  style={[styles.addBtn, { borderColor: c.border, backgroundColor: c.surface, opacity: orderable ? 1 : 0.4 }]}>
                  <Txt weight="800" color={c.brand}>
                    ADD
                  </Txt>
                </Pressable>
              )}
            </Card>
          );
        }}
      />
      {cartHere && (
        <Pressable onPress={() => router.push('/cart')} style={[styles.cartBar, { backgroundColor: c.brand }]}>
          <Txt color="#fff" weight="700">
            {cart.count} item{cart.count > 1 ? 's' : ''} · {inr(cart.subtotal)}
          </Txt>
          <Txt color="#fff" weight="800">
            View cart →
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addBtn: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 8 },
  cartBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
