import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { Button, ErrorText, Txt } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage, supabase } from '@/lib/supabase';
import { useColors } from '@/lib/theme';

export default function LoginScreen() {
  const c = useColors();
  const { session, profile, refreshProfile } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'name'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !profile) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- step follows auth state
    if (!profile.full_name) setStep('name');
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [session, profile]);

  const input = { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 14, color: c.text, fontSize: 16, backgroundColor: c.surface };

  async function sendCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setStep('code');
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: 'email' });
    setBusy(false);
    if (error) setError(errorMessage(error));
  }

  async function saveName() {
    if (!session) return;
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', session.user.id);
    setBusy(false);
    if (error) return setError(errorMessage(error));
    await refreshProfile();
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 24, gap: 14 }}>
        {step === 'email' && (
          <>
            <Txt size={24} weight="900">
              Welcome to MOM
            </Txt>
            <Txt muted>We’ll email you a 6-digit code. No password needed.</Txt>
            <TextInput
              style={input}
              autoFocus
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="you@vssut.ac.in"
              placeholderTextColor={c.muted}
              value={email}
              onChangeText={setEmail}
            />
            <ErrorText message={error} />
            <Button title={busy ? 'Sending…' : 'Send code'} disabled={busy || !email.includes('@')} onPress={sendCode} />
          </>
        )}
        {step === 'code' && (
          <>
            <Txt size={24} weight="900">
              Check your email
            </Txt>
            <Txt muted>Enter the code sent to {email}.</Txt>
            <TextInput
              style={[input, { fontSize: 28, letterSpacing: 12, textAlign: 'center' }]}
              autoFocus
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
            />
            <ErrorText message={error} />
            <Button title={busy ? 'Verifying…' : 'Verify & continue'} disabled={busy || code.length < 6} onPress={verify} />
            <Button title="Use a different email" variant="ghost" onPress={() => setStep('email')} />
          </>
        )}
        {step === 'name' && (
          <>
            <Txt size={24} weight="900">
              One last thing
            </Txt>
            <Txt muted>What should the stall call out when your order is ready?</Txt>
            <TextInput style={input} autoFocus placeholder="Your name" placeholderTextColor={c.muted} value={name} onChangeText={setName} />
            <ErrorText message={error} />
            <Button title="Continue" disabled={busy || !name.trim()} onPress={saveName} />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
