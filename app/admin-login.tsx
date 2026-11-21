import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, Coffee, LockKeyhole, ShieldCheck } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { isSupabaseConfigured, supabase } from '@/services/supabaseClient';
import { logUserActivity } from '@/services/activityLogger';

export default function AdminLoginScreen() {
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = async () => {
    if (!supabase) {
      setError('Cloud sign-in is unavailable until Supabase is configured.');
      return;
    }
    if (!email.trim() || password.length < 8) {
      setError('Enter your administrator email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      });
      if (signInError) throw signInError;
      if (data.user?.app_metadata?.role !== 'admin') {
        await supabase.auth.signOut();
        setError('This account does not have administrator access.');
        return;
      }
      void logUserActivity('user_signed_in', { source: 'admin_login' });
      router.replace('/admin');
    } catch {
      setError('Sign-in failed. Check your credentials and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} style={{ backgroundColor: theme.colors.parchment }}>
      <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center' }}>
        <Pressable onPress={() => router.replace('/auth')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 28 }}>
          <ArrowLeft size={17} color={theme.colors.secondary} />
          <Text style={{ color: theme.colors.secondary, marginLeft: 8, fontWeight: '700' }}>Back to BunaLens</Text>
        </Pressable>
        <View style={{ backgroundColor: theme.colors.emerald, width: 56, height: 56, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}>
          <Coffee size={26} color="#FFFFFF" />
        </View>
        <Text style={{ color: theme.colors.espresso, fontSize: 31, fontWeight: '900', letterSpacing: -0.8 }}>Admin sign in</Text>
        <Text style={{ color: theme.colors.secondary, fontSize: 14, lineHeight: 21, marginTop: 8 }}>Sign in to monitor BunaLens stations, batches, and payments.</Text>

        {!isSupabaseConfigured ? (
          <View style={{ backgroundColor: theme.colors.harvestSoft, padding: 14, borderRadius: 14, marginTop: 22 }}>
            <Text style={{ color: theme.colors.espresso, lineHeight: 20 }}>Supabase is not configured. Add the public Supabase URL and anon key to enable administrator sign-in.</Text>
          </View>
        ) : null}

        <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 24, padding: 22, marginTop: 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
            <ShieldCheck size={19} color={theme.colors.emerald} />
            <Text style={{ color: theme.colors.espresso, fontWeight: '800', marginLeft: 8 }}>Secure administrator access</Text>
          </View>
          <Text style={{ color: theme.colors.espresso, fontWeight: '800', marginBottom: 8 }}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" placeholder="admin@bunalens.com" editable={!busy} style={{ borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.parchment, borderRadius: 13, padding: 14, color: theme.colors.espresso }} />
          <Text style={{ color: theme.colors.espresso, fontWeight: '800', marginTop: 17, marginBottom: 8 }}>Password</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.parchment, borderRadius: 13, paddingHorizontal: 13 }}>
            <LockKeyhole size={17} color={theme.colors.secondary} />
            <TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" placeholder="Your password" editable={!busy} onSubmitEditing={signIn} style={{ flex: 1, padding: 14, color: theme.colors.espresso }} />
          </View>
          {error ? <Text accessibilityRole="alert" style={{ color: '#A33D31', marginTop: 14, lineHeight: 20 }}>{error}</Text> : null}
          <Pressable disabled={busy || !isSupabaseConfigured} onPress={signIn} accessibilityRole="button" style={{ backgroundColor: theme.colors.espresso, minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 22, opacity: busy || !isSupabaseConfigured ? 0.65 : 1 }}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontWeight: '900' }}>Continue to admin</Text>}
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => router.push('/forgot-password')} style={{ alignItems: 'center', padding: 14, marginTop: 5 }}>
            <Text style={{ color: theme.colors.emerald, fontWeight: '700' }}>Forgot password?</Text>
          </Pressable>
        </View>
        <Text style={{ color: theme.colors.secondary, fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: 20 }}>Admin access is provisioned securely by the BunaLens project owner. Public station registration cannot grant admin permissions.</Text>
      </View>
    </ScrollView>
  );
}
