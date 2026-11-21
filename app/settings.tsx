import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { ArrowLeft, Globe2, MapPin, RefreshCw, ShieldCheck, Info, LogOut, ChevronRight, Sun, Moon } from 'lucide-react-native';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOfflineQueue } from '@/contexts/OfflineQueueContext';
import { useStation } from '@/contexts/StationContext';
import { supabase } from '@/services/supabaseClient';
import LanguageToggle from '@/components/LanguageToggle';
import { useTheme } from '@/contexts/ThemeContext';
import { showAlert } from '@/services/platformAlert';

function SettingRow({ icon: Icon, title, detail, action, trailing }: { icon: React.ComponentType<any>; title: string; detail: string; action?: () => void; trailing?: React.ReactNode }) {
  const { theme } = useTheme();
  return <Pressable disabled={!action} onPress={action} className="flex-row items-center py-4" style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.line }}><View className="w-10 h-10 rounded-xl items-center justify-center mr-3" style={{ backgroundColor: theme.colors.parchment }}><Icon size={18} color={theme.colors.espresso} /></View><View className="flex-1"><Text className="text-sm font-extrabold" style={{ color: theme.colors.espresso }}>{title}</Text><Text className="text-[11px] mt-1 leading-4" style={{ color: theme.colors.secondary }}>{detail}</Text></View>{trailing ?? (action ? <ChevronRight size={16} color={theme.colors.secondary} /> : null)}</Pressable>;
}

export default function Settings() {
  const { t, language, setLanguage } = useLanguage();
  const { theme, mode, setMode } = useTheme();
  const { online, pendingCount, syncing, syncNow, refresh } = useOfflineQueue();
  const { station, setStation } = useStation();
  const [permission, setPermission] = useState<string>('unknown');
  const [permissionBusy, setPermissionBusy] = useState(false);
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const readPermission = useCallback(async () => {
    try { const result = await Location.getForegroundPermissionsAsync(); setPermission(result.status); } catch { setPermission('unknown'); }
  }, []);
  useEffect(() => { void readPermission(); void refresh(); }, [readPermission, refresh]);

  const requestLocation = async () => {
    setPermissionBusy(true);
    try { const result = await Location.requestForegroundPermissionsAsync(); setPermission(result.status); }
    catch { showAlert(t('permissionError')); }
    finally { setPermissionBusy(false); }
  };
  const logout = async () => {
    if (!supabase || station.id === 'station-demo') { showAlert(t('demoAccount')); return; }
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setStation({ id: 'station-demo', name: 'Gomma Coffee Washing Station', woreda: 'Gomma', manager: 'Station Manager', credits: 10, feresula_price_etb: 6200 });
      router.replace('/auth');
    } catch { showAlert(t('accountError'), t('accountError')); }
  };

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: theme.colors.parchment }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <View className="flex-row items-center justify-between mb-5"><Pressable onPress={() => router.back()} className="flex-row items-center py-2"><ArrowLeft size={18} color={theme.colors.espresso} /><Text className="text-sm font-bold ml-2" style={{ color: theme.colors.espresso }}>{t('back')}</Text></Pressable><LanguageToggle /></View>
      <Text className="text-2xl font-black" style={{ color: theme.colors.espresso }}>{t('settings')}</Text><Text className="text-xs mt-1 mb-5" style={{ color: theme.colors.secondary }}>{t('stationSettings')}</Text>

      <View className="rounded-3xl border p-4 mb-4" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
        <View className="flex-row items-center mb-2"><Globe2 size={17} color={theme.colors.cherry} /><Text className="text-sm font-extrabold ml-2" style={{ color: theme.colors.espresso }}>{t('language')}</Text></View>
        <Text className="text-[11px] mb-3" style={{ color: theme.colors.secondary }}>{t('changeLanguage')}</Text>
        <View className="flex-row gap-2">
          <Pressable accessibilityRole="button" accessibilityState={{ selected: language === 'en' }} onPress={() => setLanguage('en')} className="flex-1 rounded-xl p-3 items-center border" style={{ backgroundColor: language === 'en' ? theme.colors.espresso : theme.colors.parchment, borderColor: language === 'en' ? theme.colors.espresso : theme.colors.line }}><Text className="text-xs font-extrabold" style={{ color: language === 'en' ? '#FFFFFF' : theme.colors.espresso }}>EN · {t('languageEnglish')}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: language === 'om' }} onPress={() => setLanguage('om')} className="flex-1 rounded-xl p-3 items-center border" style={{ backgroundColor: language === 'om' ? theme.colors.espresso : theme.colors.parchment, borderColor: language === 'om' ? theme.colors.espresso : theme.colors.line }}><Text className="text-xs font-extrabold" style={{ color: language === 'om' ? '#FFFFFF' : theme.colors.espresso }}>OM · {t('languageOromo')}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: language === 'am' }} onPress={() => setLanguage('am')} className="flex-1 rounded-xl p-3 items-center border" style={{ backgroundColor: language === 'am' ? theme.colors.espresso : theme.colors.parchment, borderColor: language === 'am' ? theme.colors.espresso : theme.colors.line }}><Text className="text-xs font-extrabold" style={{ color: language === 'am' ? '#FFFFFF' : theme.colors.espresso }}>አማ · {t('languageAmharic')}</Text></Pressable>
        </View>
      </View>

      <View className="rounded-3xl border px-4 mb-4" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
        <Text className="text-sm font-black pt-4" style={{ color: theme.colors.espresso }}>{t('locationPermission')}</Text><Text className="text-[11px] mt-1 leading-4" style={{ color: theme.colors.secondary }}>{t('locationPermissionHint')}</Text>
        <SettingRow icon={MapPin} title={permission === 'granted' ? t('locationGranted') : t('locationDenied')} detail={permission === 'granted' ? t('locationGranted') : t('locationDenied')} action={permission === 'granted' || permissionBusy ? undefined : requestLocation} trailing={permission === 'granted' ? <ShieldCheck size={17} color={theme.colors.emerald} /> : <Text className="text-xs font-bold" style={{ color: theme.colors.cherry }}>{t('allowLocation')}</Text>} />
      </View>

      <View className="rounded-2xl border px-4 mb-4" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
        <Text className="text-sm font-black pt-4" style={{ color: theme.colors.espresso }}>{t('dataSync')}</Text><Text className="text-[11px] mt-1 leading-4" style={{ color: theme.colors.secondary }}>{t('syncDescription')}</Text>
        <SettingRow icon={RefreshCw} title={online ? t('connectionRestored') : t('offlineStatus')} detail={pendingCount + ' ' + t('pendingSamples')} action={() => void refresh()} />
        <Pressable disabled={!online || pendingCount === 0 || syncing} onPress={() => void syncNow()} className="rounded-xl p-3.5 my-3 flex-row items-center justify-center" style={{ backgroundColor: !online || pendingCount === 0 ? '#E7E5E4' : theme.colors.espresso }}><RefreshCw size={15} color={!online || pendingCount === 0 ? '#78716C' : '#FFFFFF'} /><Text className="text-xs font-extrabold ml-2" style={{ color: !online || pendingCount === 0 ? '#78716C' : '#FFFFFF' }}>{syncing ? t('statusProcessing') : t('syncNow')}</Text></Pressable>
      </View>

      <View className="rounded-2xl border px-4 mb-4" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}><Text className="text-sm font-black pt-4" style={{ color: theme.colors.espresso }}>{t('privacy')}</Text><SettingRow icon={ShieldCheck} title={t('privacy')} detail={t('privacyText')} /></View>
      <View className="rounded-2xl border px-4 mb-4" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
        <Text className="text-sm font-black pt-4" style={{ color: theme.colors.espresso }}>{t('about')}</Text><SettingRow icon={Info} title="BunaLens" detail={t('coffeeIntelligence')} /><View className="py-4" style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.line }}><View className="flex-row items-center mb-3"><View className="w-10 h-10 rounded-xl items-center justify-center mr-3" style={{ backgroundColor: theme.colors.parchment }}>{mode === 'dark' ? <Moon size={18} color={theme.colors.espresso} /> : <Sun size={18} color={theme.colors.espresso} />}</View><View className="flex-1"><Text className="text-sm font-extrabold" style={{ color: theme.colors.espresso }}>{t('themePreference')}</Text><Text className="text-[11px] mt-1" style={{ color: theme.colors.secondary }}>{mode === 'dark' ? 'Dark theme' : 'Light theme'}</Text></View></View><View className="flex-row rounded-xl p-1" style={{ backgroundColor: theme.colors.parchment }}><Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'light' }} onPress={() => setMode('light')} className="flex-1 flex-row items-center justify-center rounded-lg py-3" style={{ backgroundColor: mode === 'light' ? theme.colors.espresso : 'transparent' }}><Sun size={15} color={mode === 'light' ? '#FFFFFF' : theme.colors.secondary} /><Text className="text-xs font-extrabold ml-2" style={{ color: mode === 'light' ? '#FFFFFF' : theme.colors.espresso }}>Light</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'dark' }} onPress={() => setMode('dark')} className="flex-1 flex-row items-center justify-center rounded-lg py-3" style={{ backgroundColor: mode === 'dark' ? theme.colors.espresso : 'transparent' }}><Moon size={15} color={mode === 'dark' ? '#FFFFFF' : theme.colors.secondary} /><Text className="text-xs font-extrabold ml-2" style={{ color: mode === 'dark' ? '#FFFFFF' : theme.colors.espresso }}>Dark</Text></Pressable></View></View><SettingRow icon={Info} title={t('version')} detail={version} />
      </View>
      {station.id !== 'station-demo' ? <Pressable onPress={logout} className="rounded-xl border p-4 flex-row items-center justify-center" style={{ borderColor: '#FECACA', backgroundColor: '#FEF2F2' }}><LogOut size={16} color="#B91C1C" /><Text className="text-sm font-extrabold ml-2" style={{ color: '#B91C1C' }}>{t('logout')}</Text></Pressable> : <Text className="text-[10px] text-center mt-2" style={{ color: theme.colors.secondary }}>{t('demoAccount')}</Text>}
    </ScrollView>
  );
}
