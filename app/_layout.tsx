import '../global.css';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { StationProvider } from '@/contexts/StationContext';
import { OfflineQueueProvider } from '@/contexts/OfflineQueueContext';
import { isSupabaseConfigured, supabase } from '@/services/supabaseClient';

type AuthStatus = 'checking' | 'admin' | 'authenticated' | 'unauthenticated';

function getAuthStatus(session: { user: { app_metadata?: Record<string, unknown> } } | null): AuthStatus {
  if (!session) return 'unauthenticated';
  return session.user.app_metadata?.role === 'admin' ? 'admin' : 'authenticated';
}

function AppShell() {
  const { theme, isDark } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');

  // Restore the persisted Supabase session before exposing any application route.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthStatus('unauthenticated');
      return;
    }

    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setAuthStatus(getAuthStatus(session));
    });

    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (active) setAuthStatus(!error ? getAuthStatus(data.session) : 'unauthenticated');
      })
      .catch(() => {
        if (active) setAuthStatus('unauthenticated');
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Protect every application route. The auth screen remains reachable without a session.
  useEffect(() => {
    if (authStatus === 'checking') return;

    const segment = String(segments[0] ?? '');
    const onPublicAuthRoute = ['auth', 'admin-login', 'forgot-password', 'reset-password'].includes(segment);
    if (authStatus === 'unauthenticated' && !onPublicAuthRoute) {
      router.replace('/auth');
    } else if (authStatus === 'authenticated' && segment === 'admin') {
      router.replace('/(tabs)');
    } else if (authStatus === 'admin' && ['auth', 'admin-login'].includes(segment)) {
      router.replace('/admin');
    } else if (authStatus === 'authenticated' && segment === 'auth') {
      router.replace('/(tabs)');
    } else if (authStatus === 'admin' && segment === '(tabs)') {
      router.replace('/admin');
    }
  }, [authStatus, segments, router]);

  const segment = String(segments[0] ?? '');
  const onPublicAuthRoute = ['auth', 'admin-login', 'forgot-password', 'reset-password'].includes(segment);
  const redirecting =
    authStatus === 'checking' ||
    (authStatus === 'unauthenticated' && !onPublicAuthRoute) ||
    (authStatus === 'authenticated' && (segment === 'auth' || segment === 'admin')) ||
    (authStatus === 'admin' && ['auth', 'admin-login', '(tabs)'].includes(segment));

  return (
    <LanguageProvider>
      <StationProvider>
        <OfflineQueueProvider>
          <View style={{ flex: 1, backgroundColor: theme.colors.parchment }}>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Stack
              initialRouteName="auth"
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.parchment },
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="admin/index" />
              <Stack.Screen name="admin/coffee-plants" />
              <Stack.Screen name="admin-login" />
              <Stack.Screen name="batch/[id]" />
              <Stack.Screen name="auth" />
              <Stack.Screen name="forgot-password" />
              <Stack.Screen name="reset-password" />
              <Stack.Screen name="settings" />
            </Stack>

            {redirecting ? (
              <View
                accessibilityRole="progressbar"
                accessibilityLabel="Checking your sign-in status"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.colors.parchment,
                }}
              >
                <ActivityIndicator size="large" color="#55765D" />
                <Text style={{ color: theme.colors.espresso, marginTop: 12, fontSize: 13, fontWeight: '600' }}>
                  Checking your account…
                </Text>
              </View>
            ) : null}
          </View>
        </OfflineQueueProvider>
      </StationProvider>
    </LanguageProvider>
  );
}

export default function RootLayout() {
  return <ThemeProvider><AppShell /></ThemeProvider>;
}
