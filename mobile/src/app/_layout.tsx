import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { CartProvider } from '@/lib/cart';

SplashScreen.preventAutoHideAsync();

function HideSplashWhenReady() {
  const { loading } = useAuth();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);
  return null;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: scheme === 'dark' ? '#fb923c' : '#ea580c' } };

  return (
    <ThemeProvider value={theme}>
      <AuthProvider>
        <CartProvider>
          <HideSplashWhenReady />
          <Stack screenOptions={{ headerBackTitle: 'Back' }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="stall/[id]" options={{ title: '' }} />
            <Stack.Screen name="cart" options={{ title: 'Your order', presentation: 'modal' }} />
            <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
            <Stack.Screen name="login" options={{ title: 'Sign in', presentation: 'modal' }} />
          </Stack>
        </CartProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
