import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View, Pressable, TextInput } from 'react-native';
import { router } from 'expo-router';
import { Search, Coffee, ChevronRight, Clock3, ScanLine, ArrowDownUp } from 'lucide-react-native';
import { useStation } from '@/contexts/StationContext';
import { useLanguage } from '@/contexts/LanguageContext';
import OfflineBanner from '@/components/OfflineBanner';
import { useTheme } from '@/contexts/ThemeContext';
import LanguageToggle from '@/components/LanguageToggle';
import type { CoffeeBatch, EcxGrade, SampleType } from '@/types';

type StatusFilter = 'all' | CoffeeBatch['status'];
function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return <Pressable onPress={onPress} className="rounded-full px-3.5 py-2.5 mr-2 mb-2 border" style={{ backgroundColor: active ? theme.colors.espresso : theme.colors.surface, borderColor: active ? theme.colors.espresso : theme.colors.line }}><Text className="text-[10px] font-bold" style={{ color: active ? '#FFFFFF' : theme.colors.secondary }}>{label}</Text></Pressable>;
}

export default function Batches() {
  const { batches } = useStation();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [q, setQ] = useState('');
  const [sample, setSample] = useState<'all' | SampleType>('all');
  const [grade, setGrade] = useState<'all' | EcxGrade>('all');
  const [woreda, setWoreda] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [newestFirst, setNewestFirst] = useState(true);
  const grades: EcxGrade[] = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Undergrade', 'Unclassified'];
  const woredas = useMemo(() => [...new Set(batches.map((b) => b.woreda))].sort(), [batches]);
  const rows = useMemo(() => batches.filter((batch) => {
    const matchesQuery = (batch.batch_code + ' ' + batch.woreda).toLowerCase().includes(q.trim().toLowerCase());
    return matchesQuery && (sample === 'all' || batch.sample_type === sample) && (grade === 'all' || batch.result.ecx_grade === grade) && (woreda === 'all' || batch.woreda === woreda) && (status === 'all' || batch.status === status);
  }).sort((a, b) => newestFirst ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime() : new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [batches, q, sample, grade, woreda, status, newestFirst]);

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: theme.colors.parchment }} contentContainerStyle={{ padding: 20, paddingBottom: 36 }} showsVerticalScrollIndicator={false}>
      <View className="flex-row items-center justify-between mb-5"><View><Text className="text-2xl font-black" style={{ color: theme.colors.espresso }}>{t('batches')}</Text><Text className="text-xs mt-1" style={{ color: theme.colors.secondary }}>{t('scanHistory')}</Text></View><LanguageToggle /></View>
      <View className="rounded-3xl p-5 mb-4 flex-row items-center" style={{ backgroundColor: theme.colors.espresso }}><View className="flex-1"><Text className="text-[11px] font-semibold text-stone-300">{t('totalBatches')}</Text><Text className="text-3xl font-black text-white mt-1">{batches.length}</Text><Text className="text-[10px] text-stone-300 mt-1">{batches.filter((b) => b.status === 'demo').length} {t('demoRecords')}</Text></View><Coffee size={23} color="#FFFFFF" /></View>
      <OfflineBanner />
      <View className="flex-row items-center rounded-2xl border px-4 mt-3 mb-4" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}><Search size={18} color={theme.colors.secondary} /><TextInput value={q} onChangeText={setQ} placeholder={t('searchBatchId')} placeholderTextColor={theme.colors.muted} className="flex-1 py-3.5 px-3 text-sm" style={{ color: theme.colors.espresso }} /></View>
      <View className="flex-row items-center justify-between mb-2"><Text className="text-xs font-extrabold" style={{ color: theme.colors.espresso }}>{t('sampleTypeFilter')}</Text></View>
      <View className="flex-row flex-wrap"><FilterChip label={t('all')} active={sample === 'all'} onPress={() => setSample('all')} /><FilterChip label={t('redCherries')} active={sample === 'red_cherry'} onPress={() => setSample('red_cherry')} /><FilterChip label={t('greenBeans')} active={sample === 'green_bean'} onPress={() => setSample('green_bean')} /></View>
      <Text className="text-xs font-extrabold mt-2 mb-2" style={{ color: theme.colors.espresso }}>{t('gradeFilter')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}><FilterChip label={t('anyGrade')} active={grade === 'all'} onPress={() => setGrade('all')} />{grades.map((item) => <FilterChip key={item} label={item} active={grade === item} onPress={() => setGrade(item)} />)}</ScrollView>
      <Text className="text-xs font-extrabold mt-2 mb-2" style={{ color: theme.colors.espresso }}>{t('woredaFilter')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}><FilterChip label={t('anyWoreda')} active={woreda === 'all'} onPress={() => setWoreda('all')} />{woredas.map((item) => <FilterChip key={item} label={item} active={woreda === item} onPress={() => setWoreda(item)} />)}</ScrollView>
      <Text className="text-xs font-extrabold mt-2 mb-2" style={{ color: theme.colors.espresso }}>{t('syncFilter')}</Text>
      <View className="flex-row flex-wrap">
        {([{key:'all',label:t('anyStatus')},{key:'synced',label:t('statusSynced')},{key:'queued',label:t('statusPending')},{key:'processing',label:t('statusProcessing')},{key:'failed',label:t('statusFailed')},{key:'local',label:t('statusLocal')},{key:'demo',label:t('statusDemo')}] as const).map((item) => <FilterChip key={item.key} label={item.label} active={status === item.key} onPress={() => setStatus(item.key)} />)}
      </View>
      <View className="flex-row items-center justify-between mt-3 mb-3"><Text className="text-sm font-extrabold" style={{ color: theme.colors.espresso }}>{t('filterResults')}: {rows.length}</Text><Pressable onPress={() => setNewestFirst((v) => !v)} className="flex-row items-center rounded-lg px-3 py-2" style={{ backgroundColor: theme.colors.surface }}><ArrowDownUp size={13} color={theme.colors.cherry} /><Text className="text-[10px] font-bold ml-2" style={{ color: theme.colors.cherry }}>{newestFirst ? t('sortNewest') : t('sortOldest')}</Text></Pressable></View>
      {rows.length === 0 ? <View className="rounded-3xl border p-7 items-center mt-2" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}><View className="h-14 w-14 rounded-2xl items-center justify-center" style={{ backgroundColor: theme.colors.cherrySoft }}><ScanLine size={25} color={theme.colors.cherry} /></View><Text className="text-sm font-extrabold mt-4" style={{ color: theme.colors.espresso }}>{q || sample !== 'all' || grade !== 'all' || woreda !== 'all' || status !== 'all' ? t('noMatches') : t('noBatchesYet')}</Text><Text className="text-xs text-center leading-5 mt-1" style={{ color: theme.colors.secondary }}>{t('tryDifferentSearch')}</Text></View> : rows.map((batch) => (
        <Pressable key={batch.id} onPress={() => router.push({ pathname: '/batch/[id]', params: { id: batch.id } })} className="rounded-3xl border p-4 mb-3 flex-row items-center" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
          <View className="h-11 w-11 rounded-xl items-center justify-center mr-3" style={{ backgroundColor: theme.colors.parchment }}><Coffee size={20} color={theme.colors.espresso} /></View>
          <View className="flex-1"><Text className="text-sm font-extrabold" style={{ color: theme.colors.espresso }}>{batch.batch_code}</Text><View className="flex-row items-center mt-1"><Clock3 size={11} color={theme.colors.secondary} /><Text className="text-[11px] ml-1" style={{ color: theme.colors.secondary }}>{batch.woreda} · {new Date(batch.created_at).toLocaleDateString()}</Text></View><Text className="text-[10px] mt-1" style={{ color: theme.colors.secondary }}>{batch.sample_type === 'red_cherry' ? t('redCoffeeCherries') : t('greenCoffeeBeans')} · {batch.lot_weight_kg} kg</Text></View>
          <View className="items-end mr-2"><View className="rounded-lg px-2.5 py-1.5" style={{ backgroundColor: batch.status === 'demo' ? '#FFFBEB' : batch.status === 'failed' ? '#FEF2F2' : theme.colors.emeraldSoft }}><Text className="text-xs font-black" style={{ color: batch.status === 'demo' ? theme.colors.harvest : batch.status === 'failed' ? '#B91C1C' : theme.colors.emerald }}>{batch.status === 'demo' ? t('demoLabel') : batch.result?.ecx_grade ?? t('pending')}</Text></View><Text className="text-[9px] mt-1 font-semibold" style={{ color: theme.colors.secondary }}>{batch.status === 'demo' ? t('statusDemo') : batch.status === 'synced' ? t('synced') : batch.status === 'queued' ? t('statusPending') : batch.status === 'failed' ? t('statusFailed') : batch.status === 'processing' ? t('statusProcessing') : t('local')}</Text></View><ChevronRight size={16} color={theme.colors.muted} />
        </Pressable>
      ))}
      <Text className="text-[10px] text-center mt-3 leading-4" style={{ color: theme.colors.secondary }}>{t('disclaimer')}</Text>
    </ScrollView>
  );
}
