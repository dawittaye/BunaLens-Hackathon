import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, Pressable, Image, Animated, Easing, Platform, ActivityIndicator } from 'react-native';
import LotEnvironmentCard from '@/components/LotEnvironmentCard';
import LotScreeningCard from '@/components/LotScreeningCard';
import { fetchCloudLot } from '@/services/lots';
import { useLocalSearchParams, router } from 'expo-router';
import { useStation } from '@/contexts/StationContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import CertificateCard from '@/components/CertificateCard';
import LanguageToggle from '@/components/LanguageToggle';
import { showAlert } from '@/services/platformAlert';
import type { CoffeeBatch } from '@/types';

const DEFECTS = [
  { key: 'sound_or_ripe_pct', label: 'Sound / ripe', color: '#065F46' },
  { key: 'unripe_green_pct', label: 'Unripe / immature', color: '#D97706' },
  { key: 'black_overfermented_pct', label: 'Black / over-fermented', color: '#44403C' },
  { key: 'insect_broken_pct', label: 'Insect-damaged / broken', color: '#B91C1C' },
  { key: 'foreign_matter_pct', label: 'Foreign matter', color: '#78716C' },
] as const;

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));

const downloadDataUrl = (uri: string, fileName: string) => {
  const link = document.createElement('a');
  link.href = uri;
  link.download = fileName;
  link.click();
};

function DefectBar({ label, value, color, description }: { label: string; value: number; color: string; description: string }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: Math.max(0, Math.min(100, value)), duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [progress, value]);
  return (
    <View className="mt-4">
      <View className="flex-row justify-between items-center">
        <Text className="text-xs font-bold text-espresso flex-1">{label}</Text>
        <Text className="text-xs font-black text-espresso ml-3">{value.toFixed(1)}%</Text>
      </View>
      <View className="h-2.5 bg-stone-100 rounded-full mt-2 overflow-hidden">
        <Animated.View style={{ height: 10, borderRadius: 20, backgroundColor: color, width: progress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }} />
      </View>
      <Text className="text-[10px] text-stone-500 mt-1.5 leading-4">{description}</Text>
    </View>
  );
}

export default function Detail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { batches } = useStation();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const cert = useRef<View>(null);
  const localBatch = batches.find((item) => item.id === id);
  // A lot registered at the station may not be in this device's local
  // history, so fall back to the cloud record the signed-in account can read.
  const [cloudBatch, setCloudBatch] = useState<CoffeeBatch | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  useEffect(() => {
    if (localBatch || !id) return;
    let active = true;
    setCloudLoading(true);
    fetchCloudLot(id)
      .then((found) => { if (active) setCloudBatch(found); })
      .finally(() => { if (active) setCloudLoading(false); });
    return () => { active = false; };
  }, [id, localBatch]);
  const batch = localBatch ?? cloudBatch;
  const captureCertificatePng = async (): Promise<string> => {
    if (!cert.current) throw new Error('The certificate is not ready.');
    if (Platform.OS === 'web') {
      // react-native-view-shot delegates to findNodeHandle, which React Native
      // Web does not implement, so capture the DOM node directly.
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(cert.current as unknown as HTMLElement);
      return canvas.toDataURL('image/png');
    }
    return captureRef(cert, { format: 'png', quality: 1, result: 'tmpfile', width: 960 });
  };
  const sharePdf = async () => {
    try {
      if (!batch) return;
      const pricing = batch.pricing;
      const html = `<html><body style="font-family:Arial;padding:32px;color:#2C1810"><h1>BUNALENS DIGITAL COFFEE QUALITY CERTIFICATE</h1><h2>${escapeHtml(batch.batch_code)}</h2><p>Jimma Zone, Oromia · ${escapeHtml(batch.woreda)} · ${batch.sample_type === 'red_cherry' ? 'Red Cherry' : 'Green Bean'} · ${escapeHtml(new Date(batch.created_at).toLocaleString())}</p><h2>${escapeHtml(batch.result.ecx_grade)} · ${batch.result.quality_score}/100</h2><p>Confidence: ${batch.result.confidence_score ?? Math.round((batch.result.confidence ?? 0) * 100)}%</p><p>Lot: ${batch.lot_weight_kg} kg (${(batch.lot_weight_kg / 17).toFixed(2)} Feresula)</p><p>Estimated price: ${pricing?.estimated_price_per_feresula_etb?.toLocaleString() ?? 'Not available'} ETB / Feresula</p><p>Estimated lot value: ${pricing?.estimated_lot_value_etb?.toLocaleString() ?? 'Not available'} ETB</p><p>Verification ID: ${escapeHtml(batch.verification_id || batch.id)}</p><hr/><p>${escapeHtml(batch.result.sorting_action_advice || batch.result.assessment_note || '')}</p><p>Limitations: ${(batch.result.assessment_limitations || []).map(escapeHtml).join('; ')}</p><hr/><p>This certificate represents an AI-assisted visual assessment and is not an official Ethiopian Commodity Exchange certificate or laboratory quality report.</p></body></html>`;
      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (!printWindow) throw new Error('Allow pop-ups to print or save the certificate.');
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        return;
      }
      const file = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: t('shareCertificate') });
      else showAlert(t('pdfCreated'), file.uri);
    } catch (error) { showAlert(t('pdfExportFailed'), error instanceof Error ? error.message : t('pdfExportFailed')); }
  };
  const shareImage = async () => {
    try {
      if (!cert.current) return;
      const uri = await captureCertificatePng();
      const fileName = (batch?.batch_code || 'certificate') + '.png';
      if (Platform.OS === 'web') {
        const blob = await (await fetch(uri)).blob();
        const file = new File([blob], fileName, { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: t('shareCertificate') });
          return;
        }
        downloadDataUrl(uri, fileName);
        return;
      }
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('shareCertificate') });
      else showAlert(t('exportFailed'), t('sharingUnavailable'));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      showAlert(t('exportFailed'), error instanceof Error ? error.message : t('exportFailed'));
    }
  };
  const saveImage = async () => {
    try {
      if (!cert.current) throw new Error('App storage is unavailable.');
      const fileName = (batch?.batch_code || 'certificate') + '.png';
      if (Platform.OS === 'web') {
        downloadDataUrl(await captureCertificatePng(), fileName);
        showAlert(t('certificateSaved'), t('certificateSavedHint'));
        return;
      }
      if (!FileSystem.documentDirectory) throw new Error('App storage is unavailable.');
      const uri = await captureCertificatePng();
      const directory = FileSystem.documentDirectory + 'bunalens-certificates/';
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      await FileSystem.copyAsync({ from: uri, to: directory + fileName });
      showAlert(t('certificateSaved'), t('certificateSavedHint'));
    } catch (error) { showAlert(t('exportFailed'), error instanceof Error ? error.message : t('exportFailed')); }
  };

  if (!batch) return <View className="flex-1 p-5" style={{ backgroundColor: theme.colors.parchment }}><Text onPress={() => router.back()}>{t('back')}</Text>{cloudLoading ? <ActivityIndicator style={{ marginTop: 16 }} color="#7C2D12" /> : <Text>{t('batchNotFound')}</Text>}</View>;

  const result = batch.result;
  const pricing = batch.pricing;
  const lotFeresula = batch.lot_weight_kg / 17;
  const totalValue = pricing?.estimated_lot_value_etb ?? null;
  const sortingGain = pricing?.potential_sorting_gain_etb ?? null;
  const confidence = result.confidence_score ?? Math.round((result.confidence ?? 0) * 100);
  const cherry = batch.sample_type === 'red_cherry';
  const explanations = cherry ? [
    t('cherrySoundDesc'), t('cherryUnripeDesc'), t('cherryBlackDesc'), t('cherryDamageDesc'), t('cherryForeignDesc'),
  ] : [
    t('beanSoundDesc'), t('beanUnripeDesc'), t('beanBlackDesc'), t('beanDamageDesc'), t('beanForeignDesc'),
  ];
  const gradeColor = result.ecx_grade === 'Unclassified' ? '#78716C' : result.ecx_grade === 'Grade 1' ? '#065F46' : result.ecx_grade === 'Grade 2' ? '#047857' : '#D97706';

  return (
    <ScrollView className="flex-1 p-5" style={{ backgroundColor: theme.colors.parchment }} contentContainerStyle={{ paddingBottom: 36 }}>
      <View className="flex-row items-center justify-between">
        <Pressable onPress={() => router.back()}><Text className="text-cherry font-bold">‹ {t('back')}</Text></Pressable>
        <LanguageToggle />
      </View>
      <Text className="text-espresso text-2xl font-black mt-4">{batch.batch_code}</Text>
      <Text className="text-stone-500 text-xs mt-1">Jimma Zone, Oromia · {batch.woreda} · {new Date(batch.created_at).toLocaleString()}</Text>
      <Text testID="lot-id" className="text-stone-400 text-[10px] mt-1">Lot ID: {batch.id}</Text>
      {batch.image_uri ? <Image source={{ uri: batch.image_uri }} resizeMode="cover" style={{ width: '100%', height: 180, borderRadius: 18, marginTop: 16 }} /> : null}
      {batch.status === 'queued' ? (
        <View style={{ backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginTop: 12 }}>
          <Text testID="lot-unassessed" style={{ color: '#92400E', fontSize: 12, fontWeight: '800' }}>No sample photo assessed yet</Text>
          <Text style={{ color: '#92400E', fontSize: 11, marginTop: 4 }}>The quality figures below are placeholders until a photo of this lot is screened.</Text>
        </View>
      ) : null}

      {batch.result.screening ? <LotScreeningCard screening={batch.result.screening} imagePath={batch.image_path} /> : null}
      {batch.id.startsWith('lot_') ? (
        <Pressable testID="lot-photograph" accessibilityRole="button" onPress={() => router.push({ pathname: '/(tabs)/scan', params: { lotId: batch.id } })}
          style={{ backgroundColor: '#7C2D12', borderRadius: 14, padding: 14, marginBottom: 14, alignItems: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 13 }}>{batch.result.screening ? 'Photograph this lot again' : 'Photograph a sample for this lot'}</Text>
        </Pressable>
      ) : null}
      <LotEnvironmentCard batchId={batch.id} />

      <View className="border p-5 rounded-3xl mt-4" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}>
        <View className="flex-row justify-between items-start">
          <View className="flex-1">
            <Text className="text-stone-500 text-xs">{t('quality')} · {cherry ? t('red') : t('green')}</Text>
            <Text className="text-3xl font-black mt-1" style={{ color: gradeColor }}>{result.ecx_grade}</Text>
            {result.ecx_grade === 'Unclassified' ? <Text className="text-[10px] text-stone-500 mt-1">{t('unclassifiedReason')}</Text> : null}
            <Text className="text-espresso text-4xl font-black mt-2">{result.quality_score}<Text className="text-base text-stone-500">/100</Text></Text>
          </View>
          <View className="rounded-2xl px-3 py-2" style={{ backgroundColor: '#F5F5F4' }}>
            <Text className="text-[9px] font-bold text-stone-500">{t('confidence')}</Text>
            <Text className="text-xl font-black text-espresso">{confidence}%</Text>
          </View>
        </View>
        <View className="mt-4 pt-4 border-t border-stone-100">
          <Text className="text-[10px] font-bold text-stone-500">{t('exportReadiness')}</Text>
          <Text className="text-sm font-extrabold text-espresso mt-1">{result.export_readiness}</Text>
          <Text className="text-[10px] text-stone-500 mt-2">{t('assessmentTime')}: {new Date(batch.created_at).toLocaleString()}</Text>
          {batch.status === 'demo' ? <Text className="text-[10px] font-black text-amber-700 mt-2">{t('demonstrationData')}</Text> : null}
        </View>
      </View>

      <View className="bg-white border border-line p-4 rounded-xl mt-3">
        <Text className="text-espresso font-black">{t('financialImpact')}</Text>
        <Text className="text-stone-500 text-[10px] mt-1">{t('indicative')} · {lotFeresula.toFixed(2)} Feresula × 17 kg</Text>
        <View className="flex-row flex-wrap mt-3">
          <View className="w-1/2 py-2 pr-2"><Text className="text-[10px] text-stone-500">{t('pricePerFeresula')}</Text><Text className="text-lg font-black text-espresso">{pricing ? pricing.estimated_price_per_feresula_etb.toLocaleString() + ' ETB' : '—'}</Text></View>
          <View className="w-1/2 py-2 pl-2"><Text className="text-[10px] text-stone-500">{t('pricePerKg')}</Text><Text className="text-lg font-black text-espresso">{pricing ? pricing.estimated_price_per_kg_etb.toLocaleString() + ' ETB' : '—'}</Text></View>
          <View className="w-1/2 py-2 pr-2"><Text className="text-[10px] text-stone-500">{t('totalLotValue')}</Text><Text className="text-lg font-black text-emerald">{totalValue !== null ? totalValue.toLocaleString() + ' ETB' : '—'}</Text></View>
          <View className="w-1/2 py-2 pl-2"><Text className="text-[10px] text-stone-500">{t('potentialSortingGain')}</Text><Text className="text-lg font-black text-espresso">{sortingGain !== null ? sortingGain.toLocaleString() + ' ETB' : '—'}</Text></View>
        </View>
        {pricing ? <Text className="text-[10px] text-stone-400 mt-2">{t('source')}: {pricing.source_label} · {pricing.effective_date}{pricing.is_demo ? ' · ' + t('demonstrationData') : ''}</Text> : <Text className="text-[10px] text-stone-500 mt-2">{t('noPriceBenchmark')}</Text>}
        <Text className="text-[10px] text-stone-400 mt-2">{t('sortingDisclaimer')}</Text>
      </View>

      <View className="bg-white border border-line p-4 rounded-xl mt-3">
        <Text className="text-espresso font-black">{t('visualDefects')}</Text>
        <Text className="text-[10px] text-stone-500 mt-1">{cherry ? t('cherryBreakdownNote') : t('beanBreakdownNote')}</Text>
        {DEFECTS.map((defect, index) => <DefectBar key={defect.key} label={t(defect.key as never) || defect.label} value={result.breakdown[defect.key]} color={defect.color} description={explanations[index] ?? defect.label} />)}
      </View>

      <View className="bg-white border border-line p-4 rounded-xl mt-3">
        <Text className="text-espresso font-black">{t('sortingRecommendations')}</Text>
        <Text className="text-sm text-stone-700 leading-6 mt-2">{result.sorting_action_advice || result.assessment_note || t('noSortingAdvice')}</Text>
        {result.assessment_limitations?.length ? <><Text className="text-xs font-extrabold text-stone-600 mt-4">{t('assessmentLimitations')}</Text>{result.assessment_limitations.map((item, index) => <Text key={index} className="text-[11px] text-stone-500 leading-5 mt-1">• {item}</Text>)}</> : null}
      </View>
      <Text className="text-stone-400 text-[10px] mt-4 leading-4">{t('disclaimer')} This is a visual estimate only. It cannot establish moisture, cup quality, screen size, density or laboratory results.</Text>

      <View className="items-center mt-6">
        <Text className="text-espresso font-black text-lg mb-3">{t('certificate')}</Text>
        <View ref={cert} collapsable={false}><CertificateCard batch={batch} /></View>
      </View>
      <Pressable onPress={shareImage} className="bg-cherry p-4 rounded-xl mt-5"><Text className="text-white font-bold text-center">{t('exportImage')}</Text></Pressable>
      <Pressable onPress={saveImage} className="bg-emerald p-4 rounded-xl mt-2"><Text className="text-white font-bold text-center">{t('saveCertificate')}</Text></Pressable>
      <Pressable onPress={sharePdf} className="bg-espresso p-4 rounded-xl mt-2"><Text className="text-white font-bold text-center">{t('exportPdf')}</Text></Pressable>
    </ScrollView>
  );
}
