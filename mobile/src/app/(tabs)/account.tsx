import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorText, Loading, Txt } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage, supabase } from '@/lib/supabase';
import { useColors } from '@/lib/theme';

export default function AccountScreen() {
  const c = useColors();
  const { session, profile, loading, signOut, refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync form with loaded profile
    setName(profile?.full_name ?? '');
  }, [profile?.full_name]);

  if (loading) return <Loading />;

  if (!session) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: c.bg }}>
        <Txt size={26} weight="900">
          MOM
        </Txt>
        <Txt muted style={{ textAlign: 'center' }}>
          Order from campus food stalls and skip the queue.
        </Txt>
        <Button title="Sign in with email" onPress={() => router.push('/login')} />
      </SafeAreaView>
    );
  }

  async function save() {
    setError(null);
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', session!.user.id);
    if (error) return setError(errorMessage(error));
    await refreshProfile();
    setMsg('Saved');
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 16, gap: 14 }}>
        <Txt size={26} weight="900">
          Account
        </Txt>
        <Card style={{ padding: 16, gap: 10 }}>
          <Txt muted size={12}>
            Signed in as
          </Txt>
          <Txt weight="700">{session.user.email}</Txt>
          <Txt muted size={12} style={{ marginTop: 8 }}>
            Name (called out at the counter)
          </Txt>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={c.muted}
            style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, color: c.text, fontSize: 15 }}
          />
          <ErrorText message={error} />
          {msg && <Txt color={c.green}>{msg}</Txt>}
          <Button title="Save" onPress={save} disabled={!name.trim() || name === profile?.full_name} />
        </Card>
        {profile?.role !== 'student' && (
          <Txt muted size={13}>
            Stall owners & admins: manage orders and menus from the MOM web dashboard.
          </Txt>
        )}
        <Button title="Sign out" variant="ghost" onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}
