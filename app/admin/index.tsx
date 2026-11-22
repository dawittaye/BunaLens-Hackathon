import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';
import { router } from 'expo-router';
import {
  Activity, Building2, CheckCircle2, ChevronRight, CircleAlert, Coffee, CreditCard, FileText,
  Database, LayoutDashboard, LogOut, RefreshCw, Search, ShieldCheck, Sprout, TrendingUp, Users, ClipboardCheck,
} from 'lucide-react-native';
import { isSupabaseConfigured, supabase } from '@/services/supabaseClient';
import { useTheme } from '@/contexts/ThemeContext';
import DirectoryManager from '@/components/admin/DirectoryManager';
import UserManagement from '@/components/admin/UserManagement';
import AdminScanReview from '@/components/admin/ScanReview';
import ReportingAnalytics from '@/features/admin/ReportingAnalytics';

type AdminTab = 'overview' | 'stations' | 'payments' | 'directory' | 'users' | 'reviews' | 'coffeePlants' | 'reporting';
type StationRow = { id: string; name: string | null; manager: string | null; email: string | null; phone: string | null; woreda: string; credits: number; pro_expires_at: string | null; created_at: string };
type BatchRow = { id: string; batch_code: string; sample_type: string; woreda: string; grading_status: string; ecx_grade: string; quality_score: number | null; created_at: string; stations?: { name: string | null; manager: string | null }[] | null };
type PaymentRow = { id: string; package_id: string; amount_etb: number; currency: string; chapa_tx_ref: string; status: string; created_at: string; verified_at: string | null; stations?: { name: string | null }[] | null };

const card: ViewStyle = { backgroundColor: '#FFFFFF', borderColor: '#E5E9E0', borderWidth: 1, borderRadius: 20 };

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function MetricCard({ label, value, detail, icon: Icon, color, compact = false }: { label: string; value: string; detail: string; icon: React.ComponentType<any>; color: string; compact?: boolean }) {
  return (
    <View style={{ ...card, padding: compact ? 15 : 19, flexGrow: 1, flexBasis: compact ? 210 : 220, minWidth: 165 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: '#727C70', fontSize: 12, fontWeight: '700' }}>{label}</Text>
        <View style={{ backgroundColor: `${color}18`, width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}><Icon size={18} color={color} /></View>
      </View>
      <Text style={{ color: '#26372D', fontSize: 29, fontWeight: '900', letterSpacing: -0.7, marginTop: 13 }}>{value}</Text>
      <Text style={{ color: '#727C70', fontSize: 11, marginTop: 4 }}>{detail}</Text>
    </View>
  );
}

function SectionTitle({ title, detail, action, onAction }: { title: string; detail?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 13, marginTop: 25 }}>
      <View><Text style={{ color: '#26372D', fontSize: 17, fontWeight: '900' }}>{title}</Text>{detail ? <Text style={{ color: '#727C70', fontSize: 11, marginTop: 4 }}>{detail}</Text> : null}</View>
      {action ? <Pressable onPress={onAction} style={{ flexDirection: 'row', alignItems: 'center', padding: 6 }}><Text style={{ color: '#55765D', fontSize: 11, fontWeight: '800' }}>{action}</Text><ChevronRight size={14} color="#55765D" /></Pressable> : null}
    </View>
  );
}

function StatusPill({ value }: { value: string }) {
  const good = ['verified', 'completed'].includes(value.toLowerCase());
  const pending = ['pending', 'processing', 'queued'].includes(value.toLowerCase());
  const bg = good ? '#EAF1E8' : pending ? '#F6EFE3' : '#F7EAE5';
  const fg = good ? '#55765D' : pending ? '#9A6A37' : '#A34F3E';
  return <View style={{ backgroundColor: bg, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99, alignSelf: 'flex-start' }}><Text style={{ color: fg, fontSize: 9, fontWeight: '900', textTransform: 'capitalize' }}>{value.replaceAll('_', ' ')}</Text></View>;
}

export default function AdminDashboard() {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [stations, setStations] = useState<StationRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [stationCount, setStationCount] = useState(0);
  const [batchCount, setBatchCount] = useState(0);
  const [monthCount, setMonthCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const narrow = width < 760;

  const load = useCallback(async (quiet = false) => {
    if (!supabase) { setLoading(false); setError('Supabase is not configured for this environment.'); return; }
    if (!quiet) setLoading(true); else setRefreshing(true);
    setError('');
    try {
      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const [stationCounts, batchCounts, monthCounts, pendingCounts, stationRows, batchRows, paymentRows] = await Promise.all([
        supabase.from('stations').select('id', { count: 'exact', head: true }),
        supabase.from('coffee_batches').select('id', { count: 'exact', head: true }),
        supabase.from('coffee_batches').select('id', { count: 'exact', head: true }).gte('created_at', monthStart.toISOString()).eq('is_demo', false),
        supabase.from('station_payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('stations').select('id,name,manager,email,phone,woreda,credits,pro_expires_at,created_at').order('created_at', { ascending: false }).limit(300),
        supabase.from('coffee_batches').select('id,batch_code,sample_type,woreda,grading_status,ecx_grade,quality_score,created_at,stations(name,manager)').order('created_at', { ascending: false }).limit(300),
        supabase.from('station_payments').select('id,package_id,amount_etb,currency,chapa_tx_ref,status,created_at,verified_at,stations(name)').order('created_at', { ascending: false }).limit(300),
      ]);
      const failed = [stationCounts, batchCounts, monthCounts, pendingCounts, stationRows, batchRows, paymentRows].find((result) => result.error);
      if (failed?.error) throw failed.error;
      setStationCount(stationCounts.count ?? 0); setBatchCount(batchCounts.count ?? 0);
      setMonthCount(monthCounts.count ?? 0); setPendingCount(pendingCounts.count ?? 0);
      setStations((stationRows.data ?? []) as StationRow[]);
      setBatches((batchRows.data ?? []) as BatchRow[]);
      setPayments((paymentRows.data ?? []) as PaymentRow[]);
    } catch (e) {
      console.warn('BunaLens admin data could not be loaded', (e as { code?: string })?.code);
      setError('Admin data could not be loaded. Confirm the admin access migration is applied and your role is configured.');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredStations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return stations.filter((s) => !query || [s.name, s.manager, s.email, s.woreda].some((v) => v?.toLowerCase().includes(query)));
  }, [stations, search]);
  const filteredPayments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return payments.filter((p) => !query || [p.chapa_tx_ref, p.package_id, p.status, p.stations?.[0]?.name].some((v) => v?.toLowerCase().includes(query)));
  }, [payments, search]);
  const weekly = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - i));
    const key = date.toDateString();
    return { label: date.toLocaleDateString(undefined, { weekday: 'short' }), count: batches.filter((batch) => new Date(batch.created_at).toDateString() === key && batch.grading_status !== 'demo').length };
  }), [batches]);
  const maxWeekly = Math.max(1, ...weekly.map((day) => day.count));

  const signOut = async () => { await supabase?.auth.signOut(); router.replace('/admin-login'); };
  const tabs: { key: AdminTab; label: string; icon: React.ComponentType<any> }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'stations', label: 'Stations', icon: Building2 },
    { key: 'payments', label: 'Payments', icon: CreditCard },
    { key: 'directory', label: 'Directory', icon: Database },
    { key: 'users', label: 'Users', icon: Users },
    { key: 'reviews', label: 'Scan reviews', icon: ClipboardCheck },
    { key: 'coffeePlants', label: 'Coffee Plant Monitor', icon: Sprout },
    { key: 'reporting', label: 'Reporting & Analytics', icon: FileText },
  ];

  return (
    <View style={{ flex: 1, flexDirection: narrow ? 'column' : 'row', backgroundColor: '#F3F5EF' }}>
      <View style={{ width: narrow ? '100%' : 248, minHeight: narrow ? undefined : '100%', backgroundColor: '#26372D', paddingHorizontal: 17, paddingTop: narrow ? 14 : 28, paddingBottom: narrow ? 10 : 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: narrow ? 12 : 38 }}>
          <View style={{ width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#55765D', marginRight: 11 }}><Coffee size={22} color="#FFFFFF" /></View>
          <View style={{ flex: 1 }}><Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: -0.4 }}>BunaLens</Text><Text style={{ color: '#C3D0C1', fontSize: 9, fontWeight: '700', letterSpacing: 1.1 }}>ADMIN CONSOLE</Text></View>
          {narrow ? <Pressable onPress={() => void load(true)} accessibilityLabel="Refresh dashboard" style={{ padding: 10 }}><RefreshCw size={17} color="#FFFFFF" /></Pressable> : null}
        </View>
        {!narrow ? <Text style={{ color: '#9CAA9B', fontSize: 9, fontWeight: '900', letterSpacing: 1.3, marginHorizontal: 11, marginBottom: 10 }}>WORKSPACE</Text> : null}
        <View style={{ flexDirection: narrow ? 'row' : 'column', flexWrap: narrow ? 'wrap' : 'nowrap', gap: 5 }}>
          {tabs.map(({ key, label, icon: Icon }) => {
            const selected = tab === key;
            return <Pressable key={key} onPress={() => { if (key === 'coffeePlants') { router.push('/admin/coffee-plants'); return; } setTab(key); setSearch(''); }} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12, backgroundColor: selected ? '#3C5142' : 'transparent', flex: narrow ? 1 : undefined, minWidth: narrow ? 88 : undefined }}>
              <Icon size={16} color={selected ? '#FFFFFF' : '#AFB9AE'} /><Text style={{ color: selected ? '#FFFFFF' : '#AFB9AE', fontSize: 12, fontWeight: selected ? '800' : '600', marginLeft: 10 }}>{label}</Text>
            </Pressable>;
          })}
        </View>
        {!narrow ? <View style={{ marginTop: 'auto' as any }}>
          <View style={{ backgroundColor: '#35473A', borderRadius: 16, padding: 13, marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}><ShieldCheck size={15} color="#BBD3B3" /><Text style={{ color: '#DCE7D8', fontSize: 10, fontWeight: '800', marginLeft: 7 }}>Protected workspace</Text></View>
            <Text style={{ color: '#AEBBAD', fontSize: 9, lineHeight: 14 }}>Admin access is verified by your secure Supabase role.</Text>
          </View>
          <Pressable onPress={() => void signOut()} style={{ flexDirection: 'row', alignItems: 'center', padding: 11 }}><LogOut size={16} color="#B7C0B5" /><Text style={{ color: '#B7C0B5', fontSize: 11, fontWeight: '700', marginLeft: 10 }}>Sign out</Text></Pressable>
        </View> : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ width: '100%', maxWidth: 1500, alignSelf: 'center', padding: narrow ? 17 : 30, paddingBottom: 50 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <View style={{ flex: 1 }}><Text style={{ color: theme.colors.secondary, fontSize: 11, fontWeight: '700' }}>BUNALENS / ADMIN</Text><Text style={{ color: theme.colors.espresso, fontSize: narrow ? 26 : 31, fontWeight: '900', letterSpacing: -0.8, marginTop: 5 }}>{tab === 'overview' ? 'Operations overview' : tab === 'stations' ? 'Coffee stations' : tab === 'payments' ? 'Payment activity' : tab === 'users' ? 'User management' : tab === 'reviews' ? 'Scan review queue' : tab === 'reporting' ? 'Reporting & Analytics' : 'Location directory'}</Text><Text style={{ color: theme.colors.secondary, fontSize: 12, marginTop: 4 }}>{tab === 'overview' ? 'A live view of the BunaLens network in Jimma.' : tab === 'stations' ? 'Station accounts registered across the network.' : tab === 'payments' ? 'Verified and pending station transactions.' : tab === 'users' ? 'Monitor every registered account, station association and user activity.' : tab === 'reviews' ? 'Review every submitted coffee scan and approve eligible lots for public marketplace publication.' : tab === 'reporting' ? 'Generate and export live operational reports.' : 'Manage woredas and the station options shown during registration.'}</Text></View>
          {!narrow ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E9E0', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#55765D', marginRight: 7 }} /><Text style={{ color: '#55765D', fontSize: 10, fontWeight: '800' }}>LIVE DATA</Text></View>
            <Pressable onPress={() => void load(true)} disabled={refreshing} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#26372D', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 }}><RefreshCw size={14} color="#FFFFFF" /><Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{refreshing ? 'Refreshing' : 'Refresh'}</Text></Pressable>
          </View> : null}
        </View>

        {!isSupabaseConfigured ? <View style={{ ...card, padding: 18, borderColor: '#E7C783', backgroundColor: '#FBF5E9', marginBottom: 18 }}><Text style={{ color: '#745528', fontWeight: '800' }}>Connect Supabase to load live operational data.</Text></View> : null}
        {error ? <View style={{ ...card, padding: 15, borderColor: '#E7BDB3', backgroundColor: '#FBF0ED', marginBottom: 18, flexDirection: 'row', alignItems: 'center' }}><CircleAlert size={18} color="#A34F3E" /><Text style={{ flex: 1, color: '#7D3C32', fontSize: 12, lineHeight: 18, marginLeft: 10 }}>{error}</Text><Pressable onPress={() => void load()}><Text style={{ color: '#A34F3E', fontWeight: '900', padding: 8 }}>Retry</Text></Pressable></View> : null}

        {loading ? <View style={{ padding: 50, alignItems: 'center' }}><ActivityIndicator size="large" color={theme.colors.emerald} /><Text style={{ color: theme.colors.secondary, marginTop: 12, fontSize: 12 }}>Loading live BunaLens data…</Text></View> : <>
          {tab === 'overview' ? <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <MetricCard label="Registered stations" value={stationCount.toLocaleString()} detail="Across the Jimma network" icon={Building2} color="#55765D" />
              <MetricCard label="Coffee batches" value={batchCount.toLocaleString()} detail="All recorded samples" icon={Sprout} color="#A34F3E" />
              <MetricCard label="Scans this month" value={monthCount.toLocaleString()} detail="Real records, excluding demo" icon={Activity} color="#B7834D" />
              <MetricCard label="Pending payments" value={pendingCount.toLocaleString()} detail="Awaiting server verification" icon={CreditCard} color="#7785A2" />
            </View>

            <View style={{ flexDirection: narrow ? 'column' : 'row', gap: 15, marginTop: 20 }}>
              <View style={{ ...card, padding: 19, flex: 1.55 }}>
                <SectionTitle title="Batch activity" detail="Real assessments created over the last 7 days" />
                <View style={{ height: 142, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', paddingTop: 10 }}>
                  {weekly.map((day, index) => <View key={`${day.label}-${index}`} style={{ alignItems: 'center', justifyContent: 'flex-end', flex: 1, height: '100%' }}>
                    <Text style={{ color: '#727C70', fontSize: 9, marginBottom: 6 }}>{day.count || ''}</Text>
                    <View style={{ height: Math.max(day.count ? 10 : 3, 96 * day.count / maxWeekly), width: 22, maxWidth: '55%', borderTopLeftRadius: 7, borderTopRightRadius: 7, backgroundColor: day.count ? '#55765D' : '#EDF0EA' }} />
                    <Text style={{ color: '#727C70', fontSize: 9, marginTop: 7 }}>{day.label}</Text>
                  </View>)}
                </View>
              </View>
              <View style={{ ...card, padding: 19, flex: 1 }}>
                <SectionTitle title="Network snapshot" detail="Current account and payment state" />
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderColor: '#EEF0EC' }}><Users size={16} color="#55765D" /><Text style={{ color: '#536054', fontSize: 11, flex: 1, marginLeft: 10 }}>Active stations</Text><Text style={{ color: '#26372D', fontSize: 13, fontWeight: '900' }}>{stations.filter((s) => !s.pro_expires_at || new Date(s.pro_expires_at) > new Date()).length}</Text></View>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderColor: '#EEF0EC' }}><CheckCircle2 size={16} color="#55765D" /><Text style={{ color: '#536054', fontSize: 11, flex: 1, marginLeft: 10 }}>Verified payments</Text><Text style={{ color: '#26372D', fontSize: 13, fontWeight: '900' }}>{payments.filter((p) => p.status === 'verified').length}</Text></View>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11 }}><Database size={16} color="#B7834D" /><Text style={{ color: '#536054', fontSize: 11, flex: 1, marginLeft: 10 }}>Stations with credits</Text><Text style={{ color: '#26372D', fontSize: 13, fontWeight: '900' }}>{stations.filter((s) => s.credits > 0).length}</Text></View>
                <Text style={{ color: '#9AA298', fontSize: 9, lineHeight: 14, marginTop: 7 }}>Snapshot figures reflect the latest 300 station and payment records returned.</Text>
              </View>
            </View>

            <SectionTitle title="Recent batches" detail="Latest samples reported by stations" action="All stations" onAction={() => setTab('stations')} />
            <View style={{ ...card, overflow: 'hidden' }}>
              {batches.slice(0, 6).map((batch, index) => <View key={batch.id} style={{ flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'flex-start' : 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: index === Math.min(batches.length, 6) - 1 ? 0 : 1, borderColor: '#EEF0EC', gap: 9 }}>
                <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center' }}><Coffee size={16} color="#55765D" /></View>
                <View style={{ flex: 1 }}><Text style={{ color: '#26372D', fontSize: 11, fontWeight: '900' }}>{batch.batch_code}</Text><Text style={{ color: '#7A8378', fontSize: 10, marginTop: 3 }}>{batch.stations?.[0]?.name || 'Station'} · {batch.woreda} · {batch.sample_type === 'green_bean' ? 'Green bean' : 'Red cherry'}</Text></View>
                <Text style={{ color: '#526052', fontSize: 10, fontWeight: '700', minWidth: 78 }}>{batch.quality_score == null ? 'Unscored' : `${Math.round(batch.quality_score)}/100`}</Text>
                <StatusPill value={batch.grading_status} /><Text style={{ color: '#929A91', fontSize: 9, minWidth: 86 }}>{formatDate(batch.created_at)}</Text>
              </View>)}
              {!batches.length ? <Text style={{ color: '#727C70', padding: 20, fontSize: 12 }}>No batches have been recorded yet.</Text> : null}
            </View>
          </> : null}

          {tab === 'stations' ? <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}><MetricCard compact label="Registered stations" value={stationCount.toLocaleString()} detail="All active and historical accounts" icon={Building2} color="#55765D" /><MetricCard compact label="Available scan credits" value={stations.reduce((sum, s) => sum + s.credits, 0).toLocaleString()} detail="Across the latest 300 stations" icon={Sprout} color="#B7834D" /></View>
            <View style={{ ...card, padding: 11, flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}><Search size={17} color="#899187" /><TextInput value={search} onChangeText={setSearch} placeholder="Search station, manager, email or woreda" style={{ flex: 1, padding: 9, color: '#26372D', outlineStyle: 'none' as any }} /></View>
            <View style={{ ...card, overflow: 'hidden' }}>
              {filteredStations.map((station, index) => <View key={station.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: index === filteredStations.length - 1 ? 0 : 1, borderColor: '#EEF0EC', gap: 10 }}>
                <View style={{ width: 39, height: 39, borderRadius: 14, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center' }}><Building2 size={18} color="#55765D" /></View>
                <View style={{ flex: 1, minWidth: 120 }}><Text style={{ color: '#26372D', fontSize: 12, fontWeight: '900' }}>{station.name || 'Unnamed station'}</Text><Text style={{ color: '#7A8378', fontSize: 10, marginTop: 3 }}>{station.manager || 'Station manager'} · {station.woreda}</Text>{station.email ? <Text style={{ color: '#939B91', fontSize: 9, marginTop: 2 }}>{station.email}</Text> : null}</View>
                <View style={{ alignItems: 'flex-end' }}><Text style={{ color: '#26372D', fontSize: 12, fontWeight: '900' }}>{station.credits} <Text style={{ color: '#727C70', fontSize: 9, fontWeight: '600' }}>credits</Text></Text><Text style={{ color: '#899187', fontSize: 9, marginTop: 4 }}>{station.pro_expires_at && new Date(station.pro_expires_at) > new Date() ? 'Pro active' : 'Free plan'}</Text></View>
              </View>)}
              {!filteredStations.length ? <Text style={{ color: '#727C70', padding: 20, fontSize: 12 }}>{stations.length ? 'No stations match that search.' : 'No stations have been registered.'}</Text> : null}
              {stationCount > stations.length ? <Text style={{ color: '#929A91', padding: 12, fontSize: 9, textAlign: 'center' }}>Showing {stations.length} of {stationCount}. Search currently covers the latest 300 records.</Text> : null}
            </View>
          </> : null}

          {tab === 'payments' ? <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}><MetricCard compact label="Pending verification" value={pendingCount.toLocaleString()} detail="Payments awaiting confirmation" icon={Activity} color="#B7834D" /><MetricCard compact label="Verified ETB" value={`${payments.filter((p) => p.status === 'verified').reduce((sum, p) => sum + Number(p.amount_etb), 0).toLocaleString()} ETB`} detail="In the latest 300 transactions" icon={TrendingUp} color="#55765D" /></View>
            <View style={{ ...card, padding: 11, flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}><Search size={17} color="#899187" /><TextInput value={search} onChangeText={setSearch} placeholder="Search station, transaction or status" style={{ flex: 1, padding: 9, color: '#26372D', outlineStyle: 'none' as any }} /></View>
            <View style={{ ...card, overflow: 'hidden' }}>
              {filteredPayments.map((payment, index) => <View key={payment.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: index === filteredPayments.length - 1 ? 0 : 1, borderColor: '#EEF0EC', gap: 10 }}>
                <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: '#F6EFE3', alignItems: 'center', justifyContent: 'center' }}><CreditCard size={17} color="#B7834D" /></View>
                <View style={{ flex: 1, minWidth: 100 }}><Text style={{ color: '#26372D', fontSize: 11, fontWeight: '900' }}>{payment.stations?.[0]?.name || 'Station payment'}</Text><Text numberOfLines={1} style={{ color: '#818A7F', fontSize: 9, marginTop: 3 }}>{payment.chapa_tx_ref}</Text></View>
                <View style={{ alignItems: 'flex-end' }}><Text style={{ color: '#26372D', fontSize: 11, fontWeight: '900' }}>{Number(payment.amount_etb).toLocaleString()} ETB</Text><Text style={{ color: '#818A7F', fontSize: 9, marginTop: 3 }}>{payment.package_id === 'starter_50' ? 'Starter · 50 credits' : 'Station Pro · 30 days'}</Text></View>
                <StatusPill value={payment.status} />
                <Text style={{ color: '#929A91', fontSize: 9, minWidth: 76, textAlign: 'right' }}>{formatDate(payment.created_at)}</Text>
              </View>)}
              {!filteredPayments.length ? <Text style={{ color: '#727C70', padding: 20, fontSize: 12 }}>{payments.length ? 'No payments match that search.' : 'No payment transactions have been recorded yet.'}</Text> : null}
            </View>
          </> : null}
          {tab === 'directory' ? <DirectoryManager /> : null}
          {tab === 'users' ? <UserManagement /> : null}
          {tab === 'reviews' ? <AdminScanReview /> : null}
          {tab === 'reporting' ? <ReportingAnalytics /> : null}
        </>}
        <Text style={{ color: '#9AA298', fontSize: 9, lineHeight: 15, textAlign: 'center', marginTop: 24 }}>BunaLens provides preliminary visual screening only. Data excludes local demonstration records where indicated.</Text>
        {narrow ? <Pressable onPress={() => void signOut()} style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', padding: 15, marginTop: 4 }}><LogOut size={15} color="#727C70" /><Text style={{ color: '#727C70', fontSize: 11, fontWeight: '700', marginLeft: 8 }}>Sign out</Text></Pressable> : null}
      </ScrollView>
    </View>
  );
}
