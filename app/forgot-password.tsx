import React, { useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Link, router } from 'expo-router';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { supabase } from '@/services/supabaseClient';

export default function ForgotPasswordScreen() {
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const sendRecoveryEmail = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!supabase) {
      setError('Account recovery is temporarily unavailable. Please try again later.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const redirectTo = Platform.OS === 'web'
        ? 'https://bunalens.vercel.app/reset-password'
        : Linking.createURL('reset-password');
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
      if (requestError) throw requestError;
      // Use the same confirmation for known and unknown addresses.
      setSent(true);
    } catch (e) {
      console.warn('BunaLens password recovery request failed', (e as { code?: string })?.code);
      setError('We could not send the recovery email. Check the address and try again shortly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 px-6 justify-center" style={{ backgroundColor: theme.colors.parchment }}>
      <Text className="text-3xl font-black" style={{ color: theme.colors.espresso }}>Reset your password</Text>
      <Text className="mt-2 leading-6" style={{ color: theme.colors.secondary }}>
        Enter the email address associated with your BunaLens account. We will send you a secure password-reset link.
      </Text>

      {sent ? (
        <View className="rounded-2xl border p-5 mt-7" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
          <Text className="text-espresso text-lg font-bold">Check your email</Text>
          <Text className="text-stone-600 mt-2 leading-6">
            If an account exists for {email.trim()}, a password-reset link has been sent. Check your inbox and spam folder.
          </Text>
          <Text onPress={() => setSent(false)} accessibilityRole="link" className="text-cherry underline font-semibold mt-5">
            Try another email address
          </Text>
        </View>
      ) : (
        <View className="bg-white rounded-2xl border border-line p-5 mt-7">
          <Text className="text-espresso font-bold">Email address</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            editable={!busy}
            placeholder="you@example.com"
            className="border border-line rounded-xl p-3 mt-2 text-espresso"
          />
          {error ? <Text accessibilityRole="alert" className="text-red-700 mt-3">{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={sendRecoveryEmail}
            className="bg-cherry p-4 rounded-xl mt-5"
          >
            {busy ? <ActivityIndicator color="white" /> : <Text className="text-white text-center font-bold">Send reset link</Text>}
          </Pressable>
        </View>
      )}

      <Text onPress={() => router.replace('/auth')} accessibilityRole="link" className="text-cherry underline text-center font-semibold mt-7">
        Back to sign in
      </Text>
    </View>
  );
}
