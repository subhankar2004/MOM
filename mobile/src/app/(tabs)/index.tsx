import { Image } from 'expo-image';
import { Link, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, ErrorText, Loading, Txt } from '@/components/ui';
import { useCart } from '@/lib/cart';
import { inr } from '@/lib/money';
import { errorMessage, supabase, supabaseConfigured } from '@/lib/supabase';
import { useColors } from '@/lib/theme';
import type { Stall } from '@/lib/types';

export default function StallsScreen() {
  const c = useColors();
  const cart = useCart();
  const [stalls, setStalls] = useState<Stall[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('stalls')
      .select('*')
      .order('is_open', { ascending: false })
      .order('name');
    setError(error ? errorMessage(error) : null);
    setStalls((data as Stall[]) ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!stalls || !q) return stalls;
    return stalls.filter((s) => [s.name, s.cuisine, s.description, s.location].some((f) => f?.toLowerCase().includes(q)));
  }, [stalls, query]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={filtered ?? []}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            {!supabaseConfigured && (
              <Txt style={{ backgroundColor: '#fef9c3', color: '#854d0e', padding: 10, borderRadius: 10 }}>
                Supabase isn’t configured. Copy mobile/.env.example to mobile/.env.local.
              </Txt>
            )}
            <View style={[styles.hero, { backgroundColor: c.brand }]}>
              <Txt color="#fff" size={13} weight="600">
                Hungry between classes?
              </Txt>
              <Txt color="#fff" size={26} weight="900">
                Order ahead.{'\n'}Skip the queue.
              </Txt>
            </View>
            <TextInput
              placeholder="Search dosa, chinese, thali…"
              placeholderTextColor={c.muted}
              value={query}
              onChangeText={setQuery}
              style={[styles.search, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
            />
            <ErrorText message={error} />
            {!filtered && <Loading />}
          </View>
        }
        ListEmptyComponent={filtered ? <Txt muted style={{ textAlign: 'center', padding: 24 }}>No stalls found.</Txt> : undefined}
        renderItem={({ item: s }) => (
          <Link href={`/stall/${s.id}`} asChild>
            <Pressable>
              <Card style={[styles.row, { opacity: s.is_open ? 1 : 0.55 }]}>
                <View style={[styles.thumb, { backgroundColor: c.brandSoft }]}>
                  {s.image_url ? (
                    <Image source={s.image_url} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Txt size={30} weight="900" color={c.brand}>
                      {s.name[0]}
                    </Txt>
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Txt weight="700" size={16} style={{ flex: 1 }}>
                      {s.name}
                    </Txt>
                    <Txt size={12} weight="700" color={s.is_open ? c.green : c.muted}>
                      {s.is_open ? 'OPEN' : 'CLOSED'}
                    </Txt>
                  </View>
                  <Txt muted size={13}>
                    {s.cuisine}
                  </Txt>
                  <Txt size={13} numberOfLines={1}>
                    {s.description}
                  </Txt>
                  <Txt muted size={12}>
                    📍 {s.location} · ~{s.avg_prep_mins} min
                  </Txt>
                </View>
              </Card>
            </Pressable>
          </Link>
        )}
      />
      {cart.count > 0 && (
        <Pressable onPress={() => router.push('/cart')} style={[styles.cartBar, { backgroundColor: c.brand }]}>
          <Txt color="#fff" weight="700">
            {cart.count} item{cart.count > 1 ? 's' : ''} · {inr(cart.subtotal)} · {cart.stall?.name}
          </Txt>
          <Txt color="#fff" weight="800">
            View cart →
          </Txt>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 20, padding: 20, gap: 4 },
  search: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  row: { flexDirection: 'row', gap: 12, padding: 12 },
  thumb: { width: 72, height: 72, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cartBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
});
