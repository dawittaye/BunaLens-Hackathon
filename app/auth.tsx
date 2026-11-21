import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eye, EyeOff, Mail } from 'lucide-react-native';
import { router } from 'expo-router';
import { JIMMA_WOREDAS } from '@/constants/jimmaData';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import LanguageToggle from '@/components/LanguageToggle';
import BunaLogo from '@/components/BunaLogo';
import { useStation } from '@/contexts/StationContext';
import { useOfflineQueue } from '@/contexts/OfflineQueueContext';
import { isSupabaseConfigured, supabase } from '@/services/supabaseClient';
import { assignQueuedStation } from '@/services/offlineQueue';
import { showAlert } from '@/services/platformAlert';
import { logUserActivity } from '@/services/activityLogger';

type AuthErrorLike = { code?: string; status?: number };

export default function AuthScreen() {
  const { station, setStation } = useStation();
  const { refresh: refreshQueue } = useOfflineQueue();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(station.name);
  const [manager, setManager] = useState(station.manager);
  const [woreda, setWoreda] = useState(station.woreda);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  const connect = async () => {
    if (!supabase) {
      setFeedback(t('cloudUnavailableHint'));
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@') || password.length < 8) {
      setFeedback(t('checkCredentials'));
      return;
    }

    setFeedback('');
    setBusy(true);
    try {
      const result = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        : await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            options: { data: { full_name: manager.trim(), manager: manager.trim(), station_name: name.trim(), woreda } },
          });

      if (result.error) {
        const authError = result.error as AuthErrorLike;
        if (authError.code === 'email_not_confirmed') {
          setFeedback(t('accountCreated'));
          return;
        }
        if (authError.code === 'invalid_credentials') {
          setFeedback(t('checkCredentials'));
          return;
        }
        if (authError.code === 'user_already_exists') {
          setFeedback(t('signIn'));
          return;
        }
        if (authError.code === 'over_email_send_rate_limit' || authError.status === 429) {
          setFeedback(t('confirmEmail'));
          return;
        }
        throw result.error;
      }

      const user = result.data.user;
      const session = result.data.session;
      if (!user || !session) {
        setFeedback(t('accountCreated'));
        return;
      }

      void logUserActivity(mode === 'signup' ? 'account_registered' : 'user_signed_in');

      // Admin accounts are provisioned through Supabase Auth app_metadata. They
      // do not create a washing-station profile in the operator sign-in flow.
      if (user.app_metadata?.role === 'admin') {
        router.replace('/admin');
        return;
      }

      const { data: existing, error: lookupError } = await supabase
        .from('stations')
        .select('id,name,manager,woreda,credits,pro_expires_at')
        .eq('owner_id', user.id)
        .limit(1)
        .maybeSingle();
      if (lookupError) throw lookupError;

      const metadata = user.user_metadata ?? {};
      const metadataStationName = typeof metadata.station_name === 'string' ? metadata.station_name : '';
      const metadataManager = typeof metadata.manager === 'string'
        ? metadata.manager
        : typeof metadata.full_name === 'string' ? metadata.full_name : '';
      const metadataWoreda = typeof metadata.woreda === 'string' && JIMMA_WOREDAS.includes(metadata.woreda)
        ? metadata.woreda
        : woreda;

      let record = existing;
      if (!record) {
        const { data: created, error: createError } = await supabase
          .from('stations')
          .insert({
            owner_id: user.id,
            name: metadataStationName.trim() || name.trim() || 'My Coffee Station',
            manager: metadataManager.trim() || manager.trim() || user.email || 'Station Manager',
            woreda: metadataWoreda,
          })
          .select('id,name,manager,woreda,credits,pro_expires_at')
          .single();
        if (createError) throw createError;
        record = created;
      }

      if (!record) throw new Error('Station profile could not be loaded.');
      setStation({
        id: record.id,
        name: record.name,
        manager: record.manager || 'Station Manager',
        woreda: record.woreda,
        credits: record.credits,
        feresula_price_etb: station.feresula_price_etb,
        pro_expires_at: record.pro_expires_at || undefined,
      }, user.id);
      await assignQueuedStation(record.id);
      await refreshQueue();
      showAlert(t('stationConnected'), t('stationReady'));
      router.replace('/(tabs)/station');
    } catch (error) {
      const code = (error as AuthErrorLike | null)?.code;
      // Keep provider and database diagnostics out of the user-facing interface.
      console.warn('BunaLens account operation failed', code ? { code } : undefined);
      setFeedback(t('accountError'));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    await logUserActivity('user_signed_out');
    const { error } = await supabase.auth.signOut();
    if (error) {
      showAlert(t('accountError'), t('accountError'));
      return;
    }
    showAlert(t('signOut'), t('accountDemo'));
  };

  const fieldBorder = (field: string) =>
    focusedField === field ? theme.colors.emerald : '#E5E7EB';

  const inputStyle = (field: string) => ({
    height: 50,
    borderWidth: 1,
    borderColor: fieldBorder(field),
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    color: '#111827',
    fontSize: 16,
  } as const);

  const labelStyle = {
    color: '#374151',
    fontSize: 13,
    fontWeight: '700' as const,
    marginBottom: 8,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 34 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <BunaLogo size={42} />
                <View style={{ marginLeft: 10 }}>
                  <Text style={{ color: '#111827', fontSize: 18, fontWeight: '900', letterSpacing: -0.4 }}>BunaLens</Text>
                  <Text style={{ color: '#6B7280', fontSize: 11, marginTop: 1 }}>{t('coffeeIntelligence')}</Text>
                </View>
              </View>
              <LanguageToggle />
            </View>

            <View style={{ marginBottom: 24 }}>
              <Text style={{ color: '#111827', fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.7 }}>
                {t('accountTitle')}
              </Text>
              <Text style={{ color: '#6B7280', fontSize: 14, lineHeight: 21, marginTop: 7 }}>
                {t('accountHint')}
              </Text>
            </View>

            {!isSupabaseConfigured ? (
              <View style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A', borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 18 }}>
                <Text style={{ color: '#92400E', fontSize: 13, lineHeight: 19 }}>{t('cloudUnavailableHint')}</Text>
              </View>
            ) : null}

            <View style={{ backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', borderWidth: 1, borderRadius: 22, padding: 20, shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 2 }}>
              <View style={{ flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 12, padding: 4, marginBottom: 22 }}>
                <Pressable
                  onPress={() => { setMode('signin'); setFeedback(''); }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === 'signin' }}
                  style={{ flex: 1, minHeight: 42, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === 'signin' ? '#FFFFFF' : 'transparent', shadowColor: '#111827', shadowOpacity: mode === 'signin' ? 0.08 : 0, shadowRadius: 5, elevation: mode === 'signin' ? 1 : 0 }}
                >
                  <Text style={{ color: mode === 'signin' ? '#111827' : '#6B7280', fontSize: 14, fontWeight: '700' }}>{t('signIn')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setMode('signup'); setFeedback(''); }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === 'signup' }}
                  style={{ flex: 1, minHeight: 42, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === 'signup' ? '#FFFFFF' : 'transparent', shadowColor: '#111827', shadowOpacity: mode === 'signup' ? 0.08 : 0, shadowRadius: 5, elevation: mode === 'signup' ? 1 : 0 }}
                >
                  <Text style={{ color: mode === 'signup' ? '#111827' : '#6B7280', fontSize: 14, fontWeight: '700' }}>{t('createAccount')}</Text>
                </Pressable>
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={labelStyle}>{t('email')}</Text>
                <View style={{ height: 50, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: fieldBorder('email'), borderRadius: 12, backgroundColor: '#FFFFFF', paddingLeft: 13 }}>
                  <Mail size={17} color="#9CA3AF" />
                  <TextInput
                    value={email}
                    onChangeText={(value) => { setEmail(value); setFeedback(''); }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    placeholder="you@example.com"
                    placeholderTextColor="#9CA3AF"
                    editable={!busy}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    returnKeyType="next"
                    style={{ flex: 1, height: 50, paddingHorizontal: 11, color: '#111827', fontSize: 16 }}
                  />
                </View>
              </View>

              <View style={{ marginBottom: mode === 'signup' ? 16 : 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={labelStyle}>{t('password')}</Text>
                  {mode === 'signin' ? (
                    <Text
                      accessibilityRole="link"
                      onPress={() => router.push('/forgot-password')}
                      style={{ color: theme.colors.emerald, fontSize: 12, fontWeight: '700', paddingVertical: 2 }}
                    >
                      Forgot password?
                    </Text>
                  ) : null}
                </View>
                <View style={{ height: 50, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: fieldBorder('password'), borderRadius: 12, backgroundColor: '#FFFFFF', paddingLeft: 14 }}>
                  <TextInput
                    value={password}
                    onChangeText={(value) => { setPassword(value); setFeedback(''); }}
                    secureTextEntry={!showPassword}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    placeholder="At least 8 characters"
                    placeholderTextColor="#9CA3AF"
                    editable={!busy}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    onSubmitEditing={connect}
                    returnKeyType="done"
                    style={{ flex: 1, height: 50, color: '#111827', fontSize: 16, paddingRight: 8 }}
                  />
                  <Pressable
                    onPress={() => setShowPassword((visible) => !visible)}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    hitSlop={10}
                    style={{ width: 46, height: 48, alignItems: 'center', justifyContent: 'center' }}
                  >
                    {showPassword ? <EyeOff size={19} color="#6B7280" /> : <Eye size={19} color="#6B7280" />}
                  </Pressable>
                </View>
              </View>

              {mode === 'signup' ? (
                <>
                  <View style={{ marginBottom: 16 }}>
                    <Text style={labelStyle}>{t('stationName')}</Text>
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      editable={!busy}
                      onFocus={() => setFocusedField('stationName')}
                      onBlur={() => setFocusedField(null)}
                      style={inputStyle('stationName')}
                    />
                  </View>
                  <View style={{ marginBottom: 16 }}>
                    <Text style={labelStyle}>{t('manager')}</Text>
                    <TextInput
                      value={manager}
                      onChangeText={setManager}
                      editable={!busy}
                      onFocus={() => setFocusedField('manager')}
                      onBlur={() => setFocusedField(null)}
                      style={inputStyle('manager')}
                    />
                  </View>
                  <View style={{ marginBottom: 8 }}>
                    <Text style={labelStyle}>{t('stationWoreda')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
                      {JIMMA_WOREDAS.map((item) => {
                        const selected = item === woreda;
                        return (
                          <Pressable
                            key={item}
                            onPress={() => setWoreda(item)}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            style={{ paddingHorizontal: 13, paddingVertical: 9, margin: 4, borderRadius: 20, borderWidth: 1, borderColor: selected ? theme.colors.emerald : '#E5E7EB', backgroundColor: selected ? theme.colors.emerald : '#FFFFFF' }}
                          >
                            <Text style={{ color: selected ? '#FFFFFF' : '#4B5563', fontSize: 13, fontWeight: selected ? '700' : '500' }}>{item}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </>
              ) : null}

              {feedback ? (
                <View accessibilityRole="alert" style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginTop: 12 }}>
                  <Text style={{ color: '#DC2626', fontSize: 13, lineHeight: 18 }}>{feedback}</Text>
                </View>
              ) : null}

              <Pressable
                disabled={busy || !isSupabaseConfigured}
                onPress={connect}
                accessibilityRole="button"
                style={{ backgroundColor: theme.colors.cherry, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 20, opacity: busy || !isSupabaseConfigured ? 0.58 : 1 }}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={{ color: '#FFFFFF', textAlign: 'center', fontSize: 15, fontWeight: '800' }}>
                    {mode === 'signin' ? t('signInConnect') : t('createAccountStation')}
                  </Text>
                )}
              </Pressable>

              <Pressable onPress={signOut} disabled={busy} style={{ alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 12, marginTop: 5 }}>
                <Text style={{ color: '#9CA3AF', fontSize: 12, fontWeight: '600' }}>{t('signOut')}</Text>
              </Pressable>
            </View>

            <Pressable accessibilityRole="link" onPress={() => router.push('/admin-login')} style={{ alignSelf: 'center', paddingVertical: 20, paddingHorizontal: 10 }}>
              <Text style={{ color: theme.colors.emerald, fontSize: 12, fontWeight: '800' }}>BunaLens administrator? Open admin sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
