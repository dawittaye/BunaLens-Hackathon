import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, ShieldAlert, WifiOff } from 'lucide-react-native';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStation } from '@/contexts/StationContext';
import type { CoffeeBatch } from '@/types';

const VERIFY_BASE = process.env.EXPO_PUBLIC_CERTIFICATE_VERIFY_BASE_URL || (process.env.EXPO_PUBLIC_SUPABASE_URL ? process.env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/certificate-verify' : undefined);

type VerificationStatus = 'loading' | 'verified' | 'demo' | 'local' | 'invalid' | 'offline' | 'unavailable';
type RemoteCertificate = {
  verification_id: string;
  batch_code: string;
  sample_type: string;
  origin_woreda: string;
  assessed_at: string;
  lot_weight_kg: number;
  certified_grade: string | null;
  quality_classification: string | null;
  origin_zone: string | null;
  certified_at: string | null;
  quality_score: number | null;
  disclaimer: string;
};

export default function VerifyCertificate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { language } = useLanguage();
  const { batches } = useStation();
  const [status, setStatus] = useState<VerificationStatus>('loading');
  const [localBatch, setLocalBatch] = useState<CoffeeBatch | null>(null);
  const [remote, setRemote] = useState<RemoteCertificate | null>(null);
  const om = language === 'om';

  useEffect(() => {
    let active = true;
    const run = async () => {
      setStatus('loading');
      const local = batches.find((batch) => batch.verification_id === id || batch.id === id) || null;
      if (active) setLocalBatch(local);

      if (local?.status === 'demo') {
        if (active) setStatus('demo');
        return;
      }
      if (!VERIFY_BASE) {
        if (active) setStatus(local ? 'local' : 'unavailable');
        return;
      }
      try {
        const verifyUrl = VERIFY_BASE.endsWith('/') ? VERIFY_BASE.slice(0, -1) : VERIFY_BASE;
        const response = await fetch(verifyUrl + '/' + encodeURIComponent(id || ''));
        const payload = await response.json() as { valid?: boolean; certificate?: RemoteCertificate };
        if (!response.ok || !payload.valid || !payload.certificate) {
          if (active) setStatus('invalid');
          return;
        }
        if (active) {
          setRemote(payload.certificate);
          setStatus('verified');
        }
      } catch {
        if (active) setStatus(local ? 'local' : 'offline');
      }
    };
    void run();
    return () => { active = false; };
  }, [id, batches]);

  const title = {
    verified: om ? 'Ragaan mirkanaa’eera' : 'Certificate verified',
    demo: om ? 'Ragaa fakkeenyaa' : 'Demonstration certificate',
    local: om ? 'Galmee meeshaa kana irratti argame' : 'Local record found',
    invalid: om ? 'Ragaan hin argamne' : 'Certificate not found',
    offline: om ? 'Mirkaneessuun hin danda’amne' : 'Verification unavailable offline',
    unavailable: om ? 'Madda mirkaneessaa hin qindaa’in' : 'Verification service not configured',
    loading: om ? 'Ragaa mirkaneessaa jira…' : 'Checking certificate…',
  }[status];

  const batchCode = remote?.batch_code || localBatch?.batch_code;
  const sample = remote?.sample_type || localBatch?.sample_type;
  const woreda = remote?.origin_woreda || localBatch?.woreda;
  const grade = remote?.certified_grade;
  const classification = remote?.quality_classification;
  const originZone = remote?.origin_zone;
  const score = remote?.quality_score;

  return (
    <ScrollView className="flex-1 bg-parchment" contentContainerStyle={{ padding: 22, paddingTop: 54, paddingBottom: 40 }}>
      <Pressable onPress={() => router.back()} className="mb-7">
        <Text className="text-cherry font-bold">{om ? '‹ Duubatti' : '‹ Back'}</Text>
      </Pressable>
      <View className="items-center rounded-3xl bg-white border border-line p-6">
        {status === 'loading' ? <ActivityIndicator size="large" color="#7F1D1D" /> : null}
        {status === 'verified' ? <CheckCircle2 size={42} color="#047857" /> : null}
        {status === 'demo' || status === 'local' || status === 'invalid' || status === 'offline' || status === 'unavailable'
          ? <ShieldAlert size={42} color="#B45309" /> : null}
        <Text className="text-espresso text-xl font-black text-center mt-4">{title}</Text>
        <Text className="text-stone-500 text-xs text-center leading-5 mt-2">
          {status === 'verified'
            ? (remote?.disclaimer || (om ? 'Mirkaneessi kuusaa interneetii irraa milkaa’eera.' : 'The public verification service confirmed this record.'))
            : status === 'demo'
              ? (om ? 'Galmeen kun fakkeenya qofa. Mirkaneessa dijitaalaa dhugaa miti.' : 'This is a local demonstration record, not an independently verifiable certificate.')
              : status === 'local'
                ? (om ? 'Galmeen kun meeshaa kana irratti argameera; madda kuusaa interneetii irraa mirkaneessuun hin danda’amne.' : 'This record exists on this device, but the public verification service is not configured.')
                : status === 'offline'
                  ? (om ? 'Interneetiin hin jiru. Galmeen naannoo yoo jiraate armaan gadii ilaalaa.' : 'The verification service could not be reached. A locally saved record may still be shown below.')
                  : status === 'invalid'
                    ? (om ? 'ID kanaaf ragaan mirkanaa’e hin argamne.' : 'No matching certificate was returned by the verification service.')
                    : status === 'unavailable'
                      ? (om ? 'Mirkaneessa alaa fayyadamuuf CERTIFICATE_VERIFY_BASE_URL qindeessaa.' : 'Set EXPO_PUBLIC_CERTIFICATE_VERIFY_BASE_URL to enable independent online verification.')
                      : (om ? 'Madda ragaa ilaalaa jira.' : 'Checking the public verification endpoint.')}
        </Text>
        {batchCode ? (
          <View className="w-full border-t border-stone-100 mt-5 pt-4">
            <Text className="text-stone-500 text-[10px] font-bold">{om ? 'LAKKOOFSA BAACHII' : 'BATCH CODE'}</Text>
            <Text className="text-espresso text-lg font-black mt-1">{batchCode}</Text>
            <Text className="text-stone-600 text-xs mt-2">{sample === 'red_cherry' ? (om ? 'Buna diimaa' : 'Red cherry') : (om ? 'Buna qullaa' : 'Green bean')} · {originZone || 'Jimma'} Zone · {woreda}</Text>
            <Text className="text-espresso font-bold mt-3">{om ? 'Sadarkaa' : 'Administrator-certified grade'}: {grade || '—'}</Text>
            <Text className="text-espresso font-bold mt-1">{om ? 'Ramaddii qulqullinaa' : 'Quality classification'}: {classification || '—'}</Text>
            <Text className="text-espresso font-bold mt-1">{om ? 'Qabxii madaallii' : 'AI visual quality score'}: {score === null || score === undefined ? '—' : score + '/100'}</Text>
            {remote?.certified_at ? <Text className="text-stone-500 text-[10px] mt-2">Certified: {new Date(remote.certified_at).toLocaleString()}</Text> : null}
          </View>
        ) : null}
        {status === 'demo' || status === 'verified' ? (
          <View className="w-full rounded-xl bg-amber-50 border border-amber-200 p-3 mt-5">
            <Text className="text-amber-900 text-[10px] leading-4">{om ? 'Madaalliin BunaLens madaallii suuraa AI’n gargaarame qofa; ragaa ECX ykn gabaasa laaboraatorii miti.' : 'BunaLens provides AI-assisted visual assessment only. This is not an official ECX certificate or laboratory report.'}</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
