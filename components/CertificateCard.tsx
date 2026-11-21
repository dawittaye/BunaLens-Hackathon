import React from 'react';
import { View, Text, Image } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { CoffeeBatch } from '@/types';
import BunaLogo from './BunaLogo';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';

const VERIFY_BASE = process.env.EXPO_PUBLIC_CERTIFICATE_VERIFY_BASE_URL;

export default function CertificateCard({ batch }: { batch: CoffeeBatch }) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const verificationId = batch.verification_id || batch.id;
  const qrValue = VERIFY_BASE
    ? VERIFY_BASE.replace(/\/$/, '') + '/' + encodeURIComponent(verificationId)
    : 'bunalens://verify/' + encodeURIComponent(verificationId);
  const price = batch.pricing;
  const confidence = batch.result.confidence_score ?? Math.round((batch.result.confidence ?? 0) * 100);

  return (
    <View className="rounded-2xl p-5 w-80 items-center" style={{ backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.espresso }}>
      <BunaLogo size={52} />
      <Text className="text-espresso text-xl font-black mt-2">BunaLens</Text>
      <Text className="text-cherry text-[10px] font-black text-center mt-1">BUNALENS DIGITAL COFFEE QUALITY CERTIFICATE</Text>
      <Text className="text-stone-500 text-[9px] text-center mt-1">JIMMA ZONE · OROMIA · ETHIOPIA</Text>
      {batch.image_uri ? <Image source={{ uri: batch.image_uri }} resizeMode="cover" style={{ width: 230, height: 112, borderRadius: 10, marginTop: 14 }} /> : null}
      <Text className="text-espresso font-black text-lg mt-4">{batch.batch_code}</Text>
      <Text className="text-stone-500 text-center text-xs">{batch.sample_type === 'red_cherry' ? t('red') : t('green')} · {batch.woreda}</Text>
      <Text className="text-stone-500 text-[10px] text-center mt-1">{new Date(batch.created_at).toLocaleString()}</Text>
      <View className="w-full border-t border-stone-200 mt-3 pt-3 items-center">
        <Text className="text-stone-500 text-[9px] font-bold">{t('estimatedGrade')}</Text>
        <Text className="text-emerald text-2xl font-black mt-1">{batch.result.ecx_grade}</Text>
        <Text className="text-espresso text-sm font-black">{t('qualityScore')}: {batch.result.quality_score}/100</Text>
        <Text className="text-stone-500 text-[10px] mt-1">{t('confidence')}: {confidence}%</Text>
        <Text className="text-stone-500 text-[10px] mt-2">{t('lotWeight')}: {batch.lot_weight_kg.toLocaleString()} kg · {(batch.lot_weight_kg / 17).toFixed(2)} Feresula</Text>
        {price ? <>
          <Text className="text-espresso font-bold text-[10px] text-center mt-2">{t('pricePerFeresula')}: {price.estimated_price_per_feresula_etb.toLocaleString()} ETB</Text>
          <Text className="text-espresso font-bold text-[10px] text-center">{t('totalLotValue')}: {price.estimated_lot_value_etb.toLocaleString()} ETB</Text>
          <Text className="text-stone-400 text-[8px] text-center mt-1">{price.source_label} · {price.effective_date}{price.is_demo ? ' · DEMO BENCHMARK' : ''}</Text>
        </> : <Text className="text-stone-400 text-[9px] mt-2">{t('noPriceBenchmark')}</Text>}
      </View>
      {batch.status === 'demo' ? <Text className="text-amber-700 text-[9px] font-black mt-2">{t('demonstrationData')}</Text> : null}
      <View className="mt-4"><QRCode value={qrValue} size={88} /></View>
      <Text className="text-stone-500 text-[9px] mt-2">{t('qrVerification')}</Text>
      <Text className="text-stone-500 text-[9px] mt-1">ID: {verificationId}</Text>
      <Text className="text-stone-400 text-[8px] text-center mt-3 leading-3">{t('certificateLegalDisclaimer')}</Text>
    </View>
  );
}
