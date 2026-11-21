import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, Text, View, Pressable, TextInput } from 'react-native';
import { Warehouse, UserRound, MapPin, Pencil, Check, CreditCard, RefreshCw, ShieldCheck, ChevronRight, Sparkles, Settings as SettingsIcon, Receipt } from 'lucide-react-native';
import { useStation } from '@/contexts/StationContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { JIMMA_WOREDAS } from '@/constants/jimmaData';
import { startChapaCheckout } from '@/services/chapaService';
import { supabase } from '@/services/supabaseClient';
import { useTheme } from '@/contexts/ThemeContext';
import { showAlert } from '@/services/platformAlert';
import LanguageToggle from '@/components/LanguageToggle';
import ChapaTopUpModal from '@/components/ChapaTopUpModal';
import type { ChapaPackage } from '@/services/chapaService';
import { getDemoPaymentHistory } from '@/services/chapaService';

export default function Station() {
  const { station, setStation, addCredits } = useStation();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [name, setName] = useState(station.name);
  const [manager, setManager] = useState(station.manager);
  const [woreda, setWoreda] = useState(station.woreda);
  const [phone, setPhone] = useState(station.contact_phone || '');
  const [email, setEmail] = useState(station.contact_email || '');
  const [paymentHistory, setPaymentHistory] = useState<Array<Record<string, unknown>>>([]);
  const [edit, setEdit] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);

  useEffect(() => { setName(station.name); setManager(station.manager); setWoreda(station.woreda); setPhone(station.contact_phone || ''); setEmail(station.contact_email || ''); }, [station.name, station.manager, station.woreda, station.contact_phone, station.contact_email]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const demoRows = await getDemoPaymentHistory();
      let cloudRows: Array<Record<string, unknown>> = [];
      if (supabase && station.id !== 'station-demo') {
        const { data } = await supabase.from('station_payments').select('chapa_tx_ref,package_id,amount_etb,status,created_at').eq('station_id', station.id).order('created_at', { ascending: false }).limit(10);
        cloudRows = (data || []).map((row: any) => ({ transactionId: row.chapa_tx_ref, packageId: row.package_id, amountEtb: row.amount_etb, status: row.status, createdAt: row.created_at }));
      }
      if (active) setPaymentHistory([...cloudRows, ...demoRows].slice(0, 10));
    })();
    return () => { active = false; };
  }, [station.id]);

  const refreshBalance = async () => {
    if (!supabase || station.id === 'station-demo') {
      showAlert(t('accountDemo'), t('noCloudBalance'));
      return;
    }
    try {
      const { data, error } = await supabase.from('stations').select('credits,pro_expires_at').eq('id', station.id).single();
      if (error) throw error;
      setStation({ ...station, credits: data.credits, pro_expires_at: data.pro_expires_at || undefined });
      showAlert(t('balanceUpdated'), t('balanceLoaded'));
    } catch (error) {
      showAlert(t('refreshFailed'), error instanceof Error ? error.message : t('refreshFailed'));
    }
  };

  const checkout = async (packageId: ChapaPackage) => {
    setPaymentBusy(true);
    try {
      const result = await startChapaCheckout(packageId, station.id);
      setPaymentOpen(false);
      if (result.mode === 'demo') {
        if (!result.alreadyGranted) {
          if (result.credits > 0) addCredits(result.credits);
          if (result.proDays > 0) setStation({ ...station, pro_expires_at: new Date(Date.now() + result.proDays * 24 * 60 * 60 * 1000).toISOString() });
        }
        void getDemoPaymentHistory().then(setPaymentHistory);
        showAlert(t('paymentDemo'), result.alreadyGranted ? t('demoPaymentAlreadyApplied') : packageId === 'starter_50' ? t('demoCreditsAdded') : t('demoProActivated'));
      } else {
        await refreshBalance();
        showAlert(t('paymentPending'), t('paymentPendingHint'));
      }
    } catch (error) {
      showAlert(t('checkoutError'), error instanceof Error ? error.message : t('unableCheckout'));
    } finally { setPaymentBusy(false); }
  };

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: theme.colors.parchment }} contentContainerStyle={{ padding: 20, paddingBottom: 36 }} showsVerticalScrollIndicator={false}>
      <View className="flex-row items-center justify-between mb-5">
        <View>
          <Text className="text-2xl font-black" style={{ color: theme.colors.espresso }}>{t('station')}</Text>
          <Text className="text-xs mt-1" style={{ color: theme.colors.secondary }}>{t('manageStation')}</Text>
        </View>
        <View className="flex-row items-center gap-2"><Pressable onPress={() => router.push('/settings')} className="h-10 w-10 rounded-xl items-center justify-center" style={{ backgroundColor: theme.colors.surface }}><SettingsIcon size={18} color={theme.colors.espresso} /></Pressable><LanguageToggle /></View>
      </View>

      <Pressable onPress={() => router.push('/auth')} className="rounded-3xl border p-4 flex-row items-center" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
        <View className="h-10 w-10 rounded-xl items-center justify-center mr-3" style={{ backgroundColor: theme.colors.cherrySoft }}>
          <UserRound size={19} color={theme.colors.cherry} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-extrabold" style={{ color: theme.colors.espresso }}>{station.id === 'station-demo' ? 'Sign in / Register station' : 'Manage cloud account'}</Text>
          <Text className="text-[11px] mt-0.5" style={{ color: theme.colors.secondary }}>{station.id === 'station-demo' ? 'Connect a station to enable real AI grading' : 'Account and station access'}</Text>
        </View>
        <ChevronRight size={17} color={theme.colors.secondary} />
      </Pressable>

      <View className="rounded-3xl p-5 mt-4" style={{ backgroundColor: theme.colors.espresso }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <CreditCard size={16} color="#F5E9DF" />
            <Text className="text-xs font-bold ml-2" style={{ color: '#F5E9DF' }}>{t('scanCredits')}</Text>
          </View>
          <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}>
            <Text className="text-[9px] font-extrabold" style={{ color: '#F5E9DF' }}>{station.pro_expires_at && new Date(station.pro_expires_at).getTime() > Date.now() ? 'PRO ACTIVE' : 'PAY AS YOU GO'}</Text>
          </View>
        </View>
        <Text className="text-4xl font-black text-white mt-3">{station.credits}</Text>
        <Text className="text-xs mt-1" style={{ color: '#C7B6AC' }}>{t('availableCredits')}</Text>
        {station.pro_expires_at ? <Text className="text-[10px] mt-2" style={{ color: '#C7B6AC' }}>Pro expiry: {new Date(station.pro_expires_at).toLocaleDateString()}</Text> : null}
        <Pressable onPress={() => setPaymentOpen(true)} className="rounded-xl p-3.5 mt-5 items-center" style={{ backgroundColor: theme.colors.cherry }}>
          <Text className="text-white text-sm font-extrabold">{t('buyCreditsAndPlans')}</Text>
        </Pressable>
        <Pressable onPress={refreshBalance} className="rounded-xl p-3 mt-2 flex-row items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.10)' }}>
          <RefreshCw size={13} color="#FFFFFF" />
          <Text className="text-white text-xs font-bold ml-2">{t('refreshBalance')}</Text>
        </Pressable>
      </View>

      <View className="rounded-3xl border p-5 mt-5" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center">
            <View className="h-9 w-9 rounded-xl items-center justify-center mr-3" style={{ backgroundColor: theme.colors.parchment }}>
              <Warehouse size={18} color={theme.colors.espresso} />
            </View>
            <View>
              <Text className="text-sm font-extrabold" style={{ color: theme.colors.espresso }}>{t('stationProfile')}</Text>
              <Text className="text-[10px]" style={{ color: theme.colors.secondary }}>{t('originContact')}</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={() => { if (edit) setStation({ ...station, name, manager, woreda, contact_phone: phone.trim() || undefined, contact_email: email.trim() || undefined }); setEdit(!edit); }} className="rounded-xl px-3 py-2 flex-row items-center" style={{ backgroundColor: edit ? theme.colors.emeraldSoft : theme.colors.parchment }}>
            {edit ? <Check size={14} color={theme.colors.emerald} /> : <Pencil size={13} color={theme.colors.espresso} />}
            <Text className="text-[11px] font-extrabold ml-1" style={{ color: edit ? theme.colors.emerald : theme.colors.espresso }}>{edit ? 'Save' : 'Edit'}</Text>
          </Pressable>
        </View>
        {edit ? (
          <>
            <Text className="text-[11px] font-bold mb-1" style={{ color: theme.colors.secondary }}>{t('stationName')}</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Station name" placeholderTextColor={theme.colors.muted} className="rounded-xl border p-3 mb-3 text-sm" style={{ borderColor: theme.colors.line, color: theme.colors.espresso }} />
            <Text className="text-[11px] font-bold mb-1" style={{ color: theme.colors.secondary }}>{t('manager')}</Text>
            <TextInput value={manager} onChangeText={setManager} placeholder="Manager" placeholderTextColor={theme.colors.muted} className="rounded-xl border p-3 mb-3 text-sm" style={{ borderColor: theme.colors.line, color: theme.colors.espresso }} />
            <Text className="text-[11px] font-bold mb-1" style={{ color: theme.colors.secondary }}>{t('contactPhone')}</Text>
            <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder={t('noPhone')} placeholderTextColor={theme.colors.muted} className="rounded-xl border p-3 mb-3 text-sm" style={{ borderColor: theme.colors.line, color: theme.colors.espresso }} />
            <Text className="text-[11px] font-bold mb-1" style={{ color: theme.colors.secondary }}>{t('contactEmail')}</Text>
            <TextInput value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder={t('noEmail')} placeholderTextColor={theme.colors.muted} className="rounded-xl border p-3 mb-3 text-sm" style={{ borderColor: theme.colors.line, color: theme.colors.espresso }} />
            <Text className="text-[11px] font-bold mb-2" style={{ color: theme.colors.secondary }}>{t('stationWoreda')}</Text>
            <View className="flex-row flex-wrap">
              {JIMMA_WOREDAS.map((item) => <Pressable key={item} onPress={() => setWoreda(item)} className="p-2.5 m-1 rounded-full" style={{ backgroundColor: item === woreda ? theme.colors.espresso : theme.colors.parchment }}><Text className="text-[11px] font-bold" style={{ color: item === woreda ? '#FFFFFF' : theme.colors.espresso }}>{item}</Text></Pressable>)}
            </View>
          </>
        ) : (
          <>
            <Text className="text-lg font-black" style={{ color: theme.colors.espresso }}>{station.name}</Text>
            <View className="flex-row items-center mt-2"><UserRound size={13} color={theme.colors.secondary}/><Text className="text-xs ml-2" style={{ color: theme.colors.secondary }}>{station.manager}</Text></View>
            <View className="flex-row items-center mt-2"><MapPin size={13} color={theme.colors.secondary}/><Text className="text-xs ml-2" style={{ color: theme.colors.secondary }}>{station.woreda} · Jimma Zone, Oromia</Text></View>
            <Text className="text-xs mt-2" style={{ color: theme.colors.secondary }}>{t('contactPhone')}: {station.contact_phone || t('noPhone')}</Text>
            <Text className="text-xs mt-1" style={{ color: theme.colors.secondary }}>{t('contactEmail')}: {station.contact_email || t('noEmail')}</Text>
          </>
        )}
      </View>

      <View className="rounded-2xl border p-4 mt-5" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
        <View className="flex-row items-center mb-3"><Receipt size={16} color={theme.colors.espresso} /><Text className="text-sm font-extrabold ml-2" style={{ color: theme.colors.espresso }}>{t('paymentHistory')}</Text></View>
        {paymentHistory.length === 0 ? <Text className="text-xs" style={{ color: theme.colors.secondary }}>{t('noPayments')}</Text> : paymentHistory.slice(0, 5).map((item, index) => <View key={String(item.transactionId || index)} className="py-2 border-t border-stone-100"><View className="flex-row justify-between"><Text className="text-xs font-bold" style={{ color: theme.colors.espresso }}>{String(item.packageId || 'Package').replaceAll('_', ' ')}</Text><Text className="text-xs font-extrabold" style={{ color: theme.colors.harvest }}>{Number(item.amountEtb || 0).toLocaleString()} ETB</Text></View><Text className="text-[10px] mt-1" style={{ color: theme.colors.secondary }}>{String(item.status || 'unknown').toUpperCase()} · {String(item.createdAt || '')}</Text></View>)}
      </View>
      <Pressable onPress={() => router.push('/certificates')} className="rounded-xl p-4 mt-3 flex-row items-center justify-between" style={{ backgroundColor: theme.colors.surface }}><View><Text className="text-sm font-extrabold" style={{ color: theme.colors.espresso }}>My certifications & notifications</Text><Text className="text-[11px] mt-1" style={{ color: theme.colors.secondary }}>View admin decisions and download approved PDF certificates</Text></View><ChevronRight size={17} color={theme.colors.secondary} /></Pressable>
      <Pressable onPress={() => router.push('/settings')} className="rounded-xl p-4 mt-3 flex-row items-center justify-between" style={{ backgroundColor: theme.colors.surface }}><View><Text className="text-sm font-extrabold" style={{ color: theme.colors.espresso }}>{t('settings')}</Text><Text className="text-[11px] mt-1" style={{ color: theme.colors.secondary }}>{t('stationSettings')}</Text></View><ChevronRight size={17} color={theme.colors.secondary} /></Pressable>
      <View className="flex-row items-start mt-5 px-1">
        <ShieldCheck size={14} color={theme.colors.secondary} />
        <Text className="text-[10px] leading-4 ml-2 flex-1" style={{ color: theme.colors.secondary }}>{t('chapaDisclaimer')}</Text>
      </View>
      <View className="flex-row items-center justify-center mt-4">
        <Sparkles size={12} color={theme.colors.harvest} />
        <Text className="text-[10px] font-semibold ml-1.5" style={{ color: theme.colors.secondary }}>{t('madeForCoffee')}</Text>
      </View>
      <ChapaTopUpModal visible={paymentOpen} onClose={() => setPaymentOpen(false)} onConfirm={checkout} busy={paymentBusy} demoMode={!process.env.EXPO_PUBLIC_CHAPA_INITIALIZE_URL || process.env.EXPO_PUBLIC_CHAPA_DEMO_MODE === 'true'} />
    </ScrollView>
  );
}
