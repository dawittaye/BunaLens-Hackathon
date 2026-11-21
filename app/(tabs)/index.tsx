import React, { useMemo } from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import {
  ScanLine, TrendingUp, MapPin, ChevronRight, Coffee, ShieldCheck,
  Clock3, ArrowUpRight, Layers3, Wallet, FlaskConical, Sprout, Leaf,
} from 'lucide-react-native';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStation } from '@/contexts/StationContext';
import { useTheme } from '@/contexts/ThemeContext';
import LanguageToggle from '@/components/LanguageToggle';
import BunaLogo from '@/components/BunaLogo';
import OfflineBanner from '@/components/OfflineBanner';

function SectionHeading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { theme } = useTheme();
  return (
    <View className="flex-row items-center justify-between mb-3 mt-2">
      <Text style={{ color: theme.colors.espresso, fontSize: 18, fontWeight: '800', letterSpacing: -0.35 }}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" className="flex-row items-center py-2">
          <Text style={{ color: theme.colors.emerald, fontSize: 12, fontWeight: '800' }}>{action}</Text>
          <ChevronRight size={15} color={theme.colors.emerald} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Metric({ label, value, note, icon: Icon, accent }: {
  label: string; value: string; note: string; icon: React.ComponentType<any>; accent: string;
}) {
  const { theme } = useTheme();
  return (
    <View className="flex-1 p-4 rounded-3xl" style={{ backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line }}>
      <View className="flex-row items-center justify-between">
        <View className="w-9 h-9 rounded-2xl items-center justify-center" style={{ backgroundColor: theme.colors.parchment }}>
          <Icon size={17} color={accent} />
        </View>
        <Text style={{ color: theme.colors.secondary, fontSize: 10, fontWeight: '700' }}>{label}</Text>
      </View>
      <Text style={{ color: theme.colors.espresso, fontSize: 27, fontWeight: '800', letterSpacing: -0.8, marginTop: 13 }}>{value}</Text>
      <Text style={{ color: theme.colors.secondary, fontSize: 10, marginTop: 3 }}>{note}</Text>
    </View>
  );
}

export default function Home() {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { station, batches } = useStation();
  const actual = useMemo(() => batches.filter((b) => b.status === 'synced' && b.result), [batches]);
  const demos = useMemo(() => batches.filter((b) => b.status === 'demo'), [batches]);
  const avg = actual.length ? Math.round(actual.reduce((sum, b) => sum + b.result.quality_score, 0) / actual.length) : null;
  const pricedActual = actual.filter((b) => b.pricing && !b.pricing.is_demo);
  const actualValue = pricedActual.reduce((sum, b) => sum + (b.pricing?.estimated_lot_value_etb ?? 0), 0);
  const recent = batches.slice(0, 3);
  const currency = (value: number) => value.toLocaleString() + ' ETB';

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: theme.colors.parchment }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 42 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="flex-row items-center justify-between mb-6">
        <View className="flex-row items-center">
          <View className="mr-3"><BunaLogo size={44} /></View>
          <View>
            <Text style={{ color: theme.colors.espresso, fontSize: 20, fontWeight: '900', letterSpacing: -0.6 }}>BunaLens</Text>
            <Text style={{ color: theme.colors.secondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.7 }}>{t('coffeeIntelligence')}</Text>
          </View>
        </View>
        <LanguageToggle />
      </View>

      <OfflineBanner />

      <View className="mt-4 mb-5">
        <Text style={{ color: theme.colors.secondary, fontSize: 12, fontWeight: '600' }}>{t('welcomeBack')},</Text>
        <Text style={{ color: theme.colors.espresso, fontSize: 29, lineHeight: 36, fontWeight: '800', letterSpacing: -0.9, marginTop: 3 }}>
          {station.manager || station.name}
        </Text>
        <View className="flex-row items-center mt-2">
          <MapPin size={13} color={theme.colors.emerald} />
          <Text style={{ color: theme.colors.secondary, fontSize: 11, marginLeft: 5 }}>{station.woreda} · Jimma, Ethiopia</Text>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: theme.colors.emerald, marginHorizontal: 8 }} />
          <ShieldCheck size={13} color={theme.colors.emerald} />
          <Text style={{ color: theme.colors.secondary, fontSize: 10, marginLeft: 4 }}>{station.name}</Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/(tabs)/scan')}
        className="rounded-3xl p-5 mb-5 overflow-hidden"
        style={{ backgroundColor: theme.colors.emerald }}
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <View className="self-start flex-row items-center rounded-full px-3 py-1.5 mb-3" style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}>
              <Leaf size={12} color="#E6F0E2" />
              <Text style={{ color: '#E6F0E2', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginLeft: 6 }}>{t('aiQualityCheck')}</Text>
            </View>
            <Text style={{ color: '#FFFFFF', fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.6 }}>{t('scanYourCoffee')}</Text>
            <Text style={{ color: '#E3EDE2', fontSize: 12, lineHeight: 18, marginTop: 6 }}>{t('captureAssess')}</Text>
            <View className="self-start flex-row items-center rounded-full px-4 py-3 mt-5" style={{ backgroundColor: '#FFFFFF' }}>
              <Text style={{ color: theme.colors.emerald, fontSize: 11, fontWeight: '800' }}> {t('startFirstScan')} </Text>
              <ArrowUpRight size={15} color={theme.colors.emerald} />
            </View>
          </View>
          <View className="w-14 h-14 rounded-full items-center justify-center mt-2" style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}>
            <ScanLine size={27} color="#FFFFFF" strokeWidth={1.7} />
          </View>
        </View>
      </Pressable>

      <View className="rounded-3xl p-5 mb-5" style={{ backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line }}>
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text style={{ color: theme.colors.espresso, fontSize: 15, fontWeight: '800' }}>{t('stationOverview')}</Text>
            <Text style={{ color: theme.colors.secondary, fontSize: 10, marginTop: 3 }}>{t('availableScans')}</Text>
          </View>
          <View className="w-10 h-10 rounded-2xl items-center justify-center" style={{ backgroundColor: theme.colors.harvestSoft }}>
            <Sprout size={19} color={theme.colors.harvest} />
          </View>
        </View>
        <View className="flex-row">
          <View className="flex-1">
            <Text style={{ color: theme.colors.secondary, fontSize: 10, fontWeight: '700' }}>{t('credits')}</Text>
            <Text style={{ color: theme.colors.espresso, fontSize: 31, fontWeight: '900', marginTop: 3 }}>{station.credits}</Text>
            <Text style={{ color: theme.colors.secondary, fontSize: 10 }}>{t('availableScans')}</Text>
          </View>
          <View style={{ width: 1, backgroundColor: theme.colors.line, marginHorizontal: 18 }} />
          <View className="flex-1">
            <Text style={{ color: theme.colors.secondary, fontSize: 10, fontWeight: '700' }}>{t('averageQuality')}</Text>
            <Text style={{ color: theme.colors.espresso, fontSize: 31, fontWeight: '900', marginTop: 3 }}>{avg === null ? '—' : avg}<Text style={{ fontSize: 13, color: theme.colors.secondary }}>{avg === null ? '' : '/100'}</Text></Text>
            <Text style={{ color: theme.colors.secondary, fontSize: 10 }}>{actual.length ? t('completedScans') : t('noRealAssessments')}</Text>
          </View>
        </View>
      </View>

      <SectionHeading title={t('yourActivity')} />
      <View className="flex-row mb-4" style={{ gap: 12 }}>
        <Metric label={t('totalSavedBatches')} value={String(batches.length)} note={t('savedOnDevice')} icon={Layers3} accent={theme.colors.emerald} />
        <Metric label={t('aiAssessments')} value={String(actual.length)} note={t('completedScans')} icon={TrendingUp} accent={theme.colors.cherry} />
      </View>

      <View className="rounded-3xl flex-row items-center p-4 mb-4" style={{ backgroundColor: theme.colors.harvestSoft }}>
        <View className="w-10 h-10 rounded-2xl items-center justify-center" style={{ backgroundColor: '#FFFFFF' }}>
          <Wallet size={19} color={theme.colors.harvest} />
        </View>
        <View className="flex-1 ml-3">
          <Text style={{ color: theme.colors.secondary, fontSize: 10, fontWeight: '700' }}>{t('estimatedCoffeeValue')}</Text>
          <Text style={{ color: theme.colors.espresso, fontSize: 19, fontWeight: '900', marginTop: 2 }}>{pricedActual.length ? currency(actualValue) : '—'}</Text>
          <Text style={{ color: theme.colors.secondary, fontSize: 9, marginTop: 2 }}>{t('actualValueOnly')}</Text>
        </View>
        <TrendingUp size={18} color={theme.colors.harvest} />
      </View>

      {demos.length > 0 ? (
        <View className="rounded-2xl flex-row items-center px-3 py-3 mb-4" style={{ backgroundColor: theme.colors.harvestSoft }}>
          <FlaskConical size={15} color={theme.colors.harvest} />
          <Text style={{ color: theme.colors.espresso, fontSize: 10, fontWeight: '700', marginLeft: 8, flex: 1 }}>{demos.length} {t('demoRecords')} · {t('demonstrationData')}</Text>
        </View>
      ) : null}

      <SectionHeading title={t('recentActivity')} action={t('viewAll')} onAction={() => router.push('/(tabs)/batches')} />
      {recent.length === 0 ? (
        <View className="rounded-3xl px-5 py-8 items-center" style={{ backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line }}>
          <View className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: theme.colors.emeraldSoft }}>
            <Coffee size={25} color={theme.colors.emerald} />
          </View>
          <Text style={{ color: theme.colors.espresso, fontSize: 15, fontWeight: '800', marginTop: 13 }}>{t('batchHistoryStarts')}</Text>
          <Text style={{ color: theme.colors.secondary, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 5 }}>{t('firstBatchHint')}</Text>
          <Pressable onPress={() => router.push('/(tabs)/scan')} className="rounded-full px-5 py-3 mt-4" style={{ backgroundColor: theme.colors.espresso }}>
            <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{t('startFirstScan')}</Text>
          </Pressable>
        </View>
      ) : recent.map((batch) => (
        <Pressable
          key={batch.id}
          onPress={() => router.push({ pathname: '/batch/[id]', params: { id: batch.id } })}
          className="rounded-2xl flex-row items-center p-3 mb-2"
          style={{ backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line }}
        >
          <View className="w-11 h-11 rounded-2xl items-center justify-center mr-3" style={{ backgroundColor: theme.colors.parchment }}>
            <Coffee size={19} color={theme.colors.espresso} />
          </View>
          <View className="flex-1">
            <Text style={{ color: theme.colors.espresso, fontSize: 12, fontWeight: '800' }}>{batch.batch_code}</Text>
            <View className="flex-row items-center mt-1">
              <Clock3 size={10} color={theme.colors.secondary} />
              <Text style={{ color: theme.colors.secondary, fontSize: 10, marginLeft: 4 }}>{batch.woreda} · {new Date(batch.created_at).toLocaleDateString()}</Text>
            </View>
          </View>
          <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: batch.status === 'demo' ? theme.colors.harvestSoft : theme.colors.emeraldSoft }}>
            <Text style={{ color: batch.status === 'demo' ? theme.colors.harvest : theme.colors.emerald, fontSize: 9, fontWeight: '800' }}>{batch.status === 'demo' ? t('demoLabel') : batch.result?.ecx_grade ?? t('pending')}</Text>
          </View>
          <ChevronRight size={15} color={theme.colors.muted} style={{ marginLeft: 5 }} />
        </Pressable>
      ))}

      <Text style={{ color: theme.colors.secondary, fontSize: 9, lineHeight: 15, textAlign: 'center', marginTop: 18 }}>{t('coffeeValueDisclaimer')}</Text>
    </ScrollView>
  );
}
