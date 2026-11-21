import React, { useEffect, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '@/services/supabaseClient';

function getParams(url: string, part: 'query' | 'hash') {
  const value = part === 'query'
    ? url.split('?')[1]?.split('#')[0] ?? ''
    : url.split('#')[1] ?? '';
  return new URLSearchParams(value);
}

export default function ResetPasswordScreen() {
  const { theme } = useTheme();
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setError('Password recovery is unavailable. Please try again later.');
      setChecking(false);
      return;
    }

    const client = supabase;
    let active = true;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' && session) setReady(true);
    });

    const establishRecoverySession = async () => {
      try {
        const url = await Linking.getInitialURL();
        if (url) {
          const query = getParams(url, 'query');
          const hash = getParams(url, 'hash');
          const code = query.get('code');
          const accessToken = hash.get('access_token') ?? query.get('access_token');
          const refreshToken = hash.get('refresh_token') ?? query.get('refresh_token');

          if (code) {
            const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
            if (exchangeError) throw exchangeError;
            if (active) setReady(true);
          } else if (accessToken && refreshToken) {
            const { error: sessionError } = await client.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (sessionError) throw sessionError;
            if (active) setReady(true);
          }
        }

        const { data: { session } } = await client.auth.getSession();
        if (active && session) setReady(true);
      } catch (e) {
        console.warn('BunaLens recovery link could not be verified', (e as { code?: string })?.code);
        if (active) setError('This reset link is invalid or has expired. Request a new password-reset email.');
      } finally {
        if (active) setChecking(false);
      }
    };

    void establishRecoverySession();
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      void (async () => {
        try {
          const query = getParams(url, 'query');
          const hash = getParams(url, 'hash');
          const code = query.get('code');
          const accessToken = hash.get('access_token') ?? query.get('access_token');
          const refreshToken = hash.get('refresh_token') ?? query.get('refresh_token');
          if (code) {
            const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
            if (exchangeError) throw exchangeError;
          } else if (accessToken && refreshToken) {
            const { error: sessionError } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            if (sessionError) throw sessionError;
          }
          if (active) { setReady(true); setError(''); setChecking(false); }
        } catch {
          if (active) setError('This reset link is invalid or has expired. Request a new password-reset email.');
        }
      })();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
      linkSubscription.remove();
    };
  }, []);

  const savePassword = async () => {
    if (password.length < 8) {
      setError('Use at least 8 characters for your new password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    if (!supabase) return;

    setBusy(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setUpdated(true);
      setPassword('');
      setConfirmPassword('');
    } catch (e) {
      console.warn('BunaLens password update failed', (e as { code?: string })?.code);
      setError('We could not update your password. The reset link may have expired; request a new one and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <View className="flex-1 bg-parchment items-center justify-center px-6">
        <ActivityIndicator size="large" color="#55765D" />
        <Text className="text-stone-600 mt-4">Verifying your reset link…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 px-6 justify-center" style={{ backgroundColor: theme.colors.parchment }}>
      <Text className="text-3xl font-black" style={{ color: theme.colors.espresso }}>Create a new password</Text>
      {updated ? (
        <View className="rounded-2xl border p-5 mt-7" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
          <Text className="text-espresso text-lg font-bold">Password updated</Text>
          <Text className="text-stone-600 mt-2 leading-6">Your BunaLens password has been changed. You can now continue to your account.</Text>
          <Pressable onPress={() => router.replace('/(tabs)')} className="bg-cherry p-4 rounded-xl mt-5">
            <Text className="text-white text-center font-bold">Continue to BunaLens</Text>
          </Pressable>
        </View>
      ) : ready ? (
        <View className="bg-white rounded-2xl border border-line p-5 mt-7">
          <Text className="text-stone-600 leading-6">Choose a strong password with at least 8 characters.</Text>
          <Text className="text-espresso font-bold mt-5">New password</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" editable={!busy} placeholder="At least 8 characters" className="border border-line rounded-xl p-3 mt-2 text-espresso" />
          <Text className="text-espresso font-bold mt-4">Confirm new password</Text>
          <TextInput value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoComplete="new-password" editable={!busy} placeholder="Enter the password again" className="border border-line rounded-xl p-3 mt-2 text-espresso" />
          {error ? <Text accessibilityRole="alert" className="text-red-700 mt-3">{error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy} onPress={savePassword} className="bg-cherry p-4 rounded-xl mt-5">
            {busy ? <ActivityIndicator color="white" /> : <Text className="text-white text-center font-bold">Update password</Text>}
          </Pressable>
        </View>
      ) : (
        <View className="bg-white rounded-2xl border border-line p-5 mt-7">
          <Text className="text-stone-600 leading-6">{error || 'Open the password-reset link from your email on this device to continue.'}</Text>
          <Text onPress={() => router.replace('/forgot-password')} accessibilityRole="link" className="text-cherry underline font-semibold mt-5">Request a new reset link</Text>
        </View>
      )}
      {!updated ? (
        <Text onPress={() => router.replace('/auth')} accessibilityRole="link" className="text-cherry underline text-center font-semibold mt-7">Back to sign in</Text>
      ) : null}
    </View>
  );
}
