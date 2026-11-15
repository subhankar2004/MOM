import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorText, Loading, StatusPill, Txt } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { inr } from '@/lib/money';
import { errorMessage, supabase } from '@/lib/supabase';
import { useColors } from '@/lib/theme';
import type { Order } from '@/lib/types';

export default function OrdersScreen() {
  const c = useColors();
  const { session, loading } = useAuth();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const uid = session?.user.id;

  const load = useCallback(async () => {
    if (!uid) return;
    const { data, error } = await supabase
      .from('orders')
      .select('*, stalls(name, location), order_items(*)')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(50);
    setError(error ? errorMessage(error) : null);
    setOrders((data as Order[]) ?? []);
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel(`my-orders-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${uid}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid, load]);

  if (loading) return <Loading />;

  if (!session) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: c.bg }}>
        <Txt weight="700" size={18}>
          Sign in to see your orders
        </Txt>
        <Button title="Sign in" onPress={() => router.push('/login')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={orders ?? []}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
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
          <View>
            <Txt size={26} weight="900">
              Your orders
            </Txt>
            <ErrorText message={error} />
            {!orders && <Loading />}
          </View>
        }
        ListEmptyComponent={orders ? <Txt muted style={{ textAlign: 'center', padding: 24 }}>No orders yet.</Txt> : undefined}
        renderItem={({ item: o }) => (
          <Link href={`/order/${o.id}`} asChild>
            <Pressable>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
                <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt size={9} muted weight="700">
                    TOKEN
                  </Txt>
                  <Txt size={20} weight="900" color={c.brand}>
                    {o.token_no ?? '–'}
                  </Txt>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="700">{o.stalls?.name}</Txt>
                  <Txt muted size={12} numberOfLines={1}>
                    {o.order_items?.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                  </Txt>
                  <StatusPill status={o.status} />
                </View>
                <Txt weight="700">{inr(o.total_paise)}</Txt>
              </Card>
            </Pressable>
          </Link>
        )}
      />
    </SafeAreaView>
  );
}
