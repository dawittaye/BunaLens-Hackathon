import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Bell, Award, Download, RefreshCw, ChevronLeft, ShieldCheck } from 'lucide-react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/services/supabaseClient';
import { useStation } from '@/contexts/StationContext';
import { useTheme } from '@/contexts/ThemeContext';

type Certification = {
  id: string; batch_code: string; sample_type: string; woreda: string; lot_weight_kg: number;
  created_at: string; verification_id: string; certification_status: string; certified_grade: string | null;
  quality_classification: string | null; certification_origin_zone: string | null; certified_at: string | null;
  certification_note: string | null; stations?: { zone?: string | null } | null;
};
type Notification = { id: string; title: string; message: string; notification_type: string; read_at: string | null; created_at: string; batch_id: string | null };

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));

export default function Certificates() {
  const { station } = useStation();
  const { theme } = useTheme();
  const [rows, setRows] = useState<Certification[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    if (!supabase || station.id === 'station-demo') { setRows([]); setNotifications([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error('Sign in to view your certificates and notifications.');
      const [{ data: batches, error: batchError }, { data: notes, error: noteError }] = await Promise.all([
        supabase.from('coffee_batches')
          .select('id,batch_code,sample_type,woreda,lot_weight_kg,created_at,verification_id,certification_status,certified_grade,quality_classification,certification_origin_zone,certified_at,certification_note,stations(zone)')
          .eq('station_id', station.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('user_notifications')
          .select('id,title,message,notification_type,read_at,created_at,batch_id')
          .eq('user_id', userData.user.id).order('created_at', { ascending: false }).limit(50),
      ]);
      if (batchError) throw batchError;
      if (noteError) throw noteError;
      setRows((batches || []) as unknown as Certification[]);
      setNotifications((notes || []) as Notification[]);
    } catch (error) {
      Alert.alert('Unable to load certifications', error instanceof Error ? error.message : 'Please try again.');
    } finally { setLoading(false); }
  }, [station.id]);

  useEffect(() => { void load(); }, [load]);

  const markRead = async (item: Notification) => {
    if (!supabase || item.read_at) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('user_notifications').update({ read_at: now }).eq('id', item.id);
    if (!error) setNotifications((current) => current.map((row) => row.id === item.id ? { ...row, read_at: now } : row));
  };

  const downloadCertificate = async (row: Certification) => {
    if (!row.certified_grade || !row.quality_classification || row.certification_status !== 'certified') return;
    setBusyId(row.id);
    try {
      const verifyBase = process.env.EXPO_PUBLIC_CERTIFICATE_VERIFY_BASE_URL || (process.env.EXPO_PUBLIC_SUPABASE_URL ? process.env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/certificate-verify' : 'https://bunalens.vercel.app/verify');
      const verifyUrl = verifyBase.replace(/\/$/, '') + '/' + encodeURIComponent(row.verification_id);
      const originZone = row.certification_origin_zone || row.stations?.zone || 'Jimma';
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        body{font-family:Arial,sans-serif;color:#26372d;padding:34px} .brand{text-align:center;font-size:26px;font-weight:800;color:#365b42}
        h1{text-align:center;font-size:19px;margin:8px 0;color:#8b3d32} .sub{text-align:center;color:#68756a;font-size:11px}
        .panel{border:2px solid #55765d;border-radius:14px;padding:22px;margin-top:24px}
        .row{padding:10px 0;border-bottom:1px solid #e5e9e0}.label{font-size:10px;color:#68756a;text-transform:uppercase}
        .value{font-size:15px;font-weight:700;margin-top:4px}.grade{font-size:28px;color:#365b42;font-weight:800}
        .note{font-size:11px;line-height:1.5;color:#68756a;margin-top:18px} a{color:#365b42;word-break:break-all}
      </style></head><body><div class="brand">BunaLens</div><h1>ADMIN-VERIFIED COFFEE QUALITY CERTIFICATE</h1>
      <div class="sub">BunaLens administrator certification · Ethiopia</div><div class="panel">
      <div class="row"><div class="label">Batch identification</div><div class="value">${escapeHtml(row.batch_code)}</div></div>
      <div class="row"><div class="label">Coffee type</div><div class="value">${row.sample_type === 'red_cherry' ? 'Red Cherry' : 'Green Bean'}</div></div>
      <div class="row"><div class="label">Certified grade</div><div class="grade">${escapeHtml(row.certified_grade)}</div></div>
      <div class="row"><div class="label">Quality classification</div><div class="value">${escapeHtml(row.quality_classification)}</div></div>
      <div class="row"><div class="label">Origin</div><div class="value">${escapeHtml(originZone)} Zone, ${escapeHtml(row.woreda)} Woreda, Oromia, Ethiopia</div></div>
      <div class="row"><div class="label">Lot weight</div><div class="value">${Number(row.lot_weight_kg).toLocaleString()} kg</div></div>
      <div class="row"><div class="label">Certified on</div><div class="value">${row.certified_at ? new Date(row.certified_at).toLocaleString() : '—'}</div></div>
      <div class="row"><div class="label">Certificate verification ID</div><div class="value">${escapeHtml(row.verification_id)}</div></div>
      </div><p class="note">This certificate records a BunaLens administrator's review of the submitted coffee sample and its supporting evidence. It is not an Ethiopian Commodity Exchange (ECX) laboratory certificate or a substitute for laboratory testing. Verify this certificate online: <a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p></body></html>`;
      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
      } else {
        const file = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Save BunaLens certificate' });
        else Alert.alert('PDF created', file.uri);
      }
    } catch (error) {
      Alert.alert('Certificate could not be generated', error instanceof Error ? error.message : 'Please try again.');
    } finally { setBusyId(''); }
  };

  const pending = rows.filter((row) => row.certification_status === 'pending_admin_review' || row.certification_status === 'rejected');
  const certified = rows.filter((row) => row.certification_status === 'certified');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.parchment }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <Pressable onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}><ChevronLeft size={18} color={theme.colors.espresso} /><Text style={{ color: theme.colors.espresso, fontWeight: '800' }}>Back</Text></Pressable>
        <Pressable onPress={() => void load()} style={{ padding: 8 }}><RefreshCw size={17} color={theme.colors.emerald} /></Pressable>
      </View>
      <Text style={{ color: theme.colors.espresso, fontSize: 25, fontWeight: '900' }}>My certifications</Text>
      <Text style={{ color: theme.colors.secondary, fontSize: 12, marginTop: 5 }}>Administrator decisions, notifications and downloadable PDF certificates.</Text>

      <View style={{ marginTop: 22, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}><Bell size={16} color={theme.colors.cherry} /><Text style={{ color: theme.colors.espresso, fontWeight: '900', marginLeft: 8 }}>Notifications</Text></View>
      {notifications.length === 0 ? <Text style={{ color: theme.colors.secondary, fontSize: 12, paddingVertical: 12 }}>No certification notifications yet.</Text> : notifications.map((item) => (
        <Pressable key={item.id} onPress={() => void markRead(item)} style={{ padding: 13, borderRadius: 14, marginBottom: 8, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line, opacity: item.read_at ? 0.72 : 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: theme.colors.espresso, fontSize: 12, fontWeight: '900', flex: 1 }}>{item.title}</Text>{!item.read_at ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.cherry }} /> : null}</View>
          <Text style={{ color: theme.colors.secondary, fontSize: 11, lineHeight: 17, marginTop: 5 }}>{item.message}</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 9, marginTop: 6 }}>{new Date(item.created_at).toLocaleString()}</Text>
        </Pressable>
      ))}

      <View style={{ marginTop: 18, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}><Award size={16} color={theme.colors.emerald} /><Text style={{ color: theme.colors.espresso, fontWeight: '900', marginLeft: 8 }}>Certified coffee samples</Text></View>
      {loading ? <View style={{ padding: 28, alignItems: 'center' }}><ActivityIndicator color={theme.colors.emerald} /></View> : certified.length === 0 ? <Text style={{ color: theme.colors.secondary, fontSize: 12, paddingVertical: 12 }}>No certificates have been issued yet. Your submitted samples will appear here after admin approval.</Text> : certified.map((row) => (
        <View key={row.id} style={{ padding: 15, borderRadius: 16, marginBottom: 10, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}><ShieldCheck size={18} color={theme.colors.emerald} /><Text style={{ color: theme.colors.espresso, fontWeight: '900', marginLeft: 8, flex: 1 }}>{row.batch_code}</Text><Text style={{ color: theme.colors.emerald, fontSize: 9, fontWeight: '900' }}>CERTIFIED</Text></View>
          <Text style={{ color: theme.colors.espresso, fontSize: 13, fontWeight: '800', marginTop: 10 }}>{row.certified_grade} · {row.quality_classification}</Text>
          <Text style={{ color: theme.colors.secondary, fontSize: 11, marginTop: 4 }}>{row.sample_type === 'red_cherry' ? 'Red Cherry' : 'Green Bean'} · {row.certification_origin_zone || 'Jimma'} Zone · {row.woreda} · {Number(row.lot_weight_kg).toLocaleString()} kg</Text>
          <Pressable disabled={busyId === row.id} onPress={() => void downloadCertificate(row)} style={{ backgroundColor: theme.colors.espresso, borderRadius: 11, padding: 12, marginTop: 13, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', opacity: busyId === row.id ? 0.6 : 1 }}>
            {busyId === row.id ? <ActivityIndicator color="#FFFFFF" /> : <Download size={15} color="#FFFFFF" />}<Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 11, marginLeft: 7 }}>{busyId === row.id ? 'Preparing PDF…' : 'Generate / download PDF certificate'}</Text>
          </Pressable>
        </View>
      ))}

      <View style={{ marginTop: 18, marginBottom: 8 }}><Text style={{ color: theme.colors.espresso, fontWeight: '900' }}>Awaiting administrator review</Text></View>
      {pending.length === 0 ? <Text style={{ color: theme.colors.secondary, fontSize: 12 }}>No samples are waiting for review.</Text> : pending.map((row) => <View key={row.id} style={{ padding: 13, borderRadius: 13, marginBottom: 7, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line }}><Text style={{ color: theme.colors.espresso, fontWeight: '800', fontSize: 12 }}>{row.batch_code}</Text><Text style={{ color: theme.colors.secondary, fontSize: 10, marginTop: 4 }}>{row.certification_status === 'rejected' ? 'Not certified — see the notification above.' : 'Submitted · waiting for admin certification'}</Text></View>)}
      <Text style={{ color: theme.colors.muted, fontSize: 9, lineHeight: 14, marginTop: 20, textAlign: 'center' }}>BunaLens administrator certification is not an official ECX laboratory certificate.</Text>
    </ScrollView>
  );
}
