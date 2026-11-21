import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Activity, CheckCircle2, ChevronLeft, ChevronRight, Clock3, RefreshCw, Search, ShieldAlert, UserRound, Users, XCircle } from 'lucide-react-native';
import { supabase } from '@/services/supabaseClient';

type ManagedUser = {
  id: string; email: string | null; phone: string | null; created_at: string;
  last_sign_in_at: string | null; email_confirmed_at: string | null; phone_confirmed_at: string | null;
  banned_until: string | null; role: string; full_name: string | null;
  station: { id: string; name: string | null; woreda: string; phone: string | null } | null;
  batch_count: number; status: 'verified' | 'unverified' | 'suspended';
};
type ActivityRow = { id: string; user_id: string; event_type: string; metadata: Record<string, unknown>; created_at: string };
type Payload = { users: ManagedUser[]; activity: ActivityRow[]; summary: { total: number; active30d: number; verified: number; unverified: number; suspended: number }; page: number; perPage: number; totalPages: number };

const panel = { backgroundColor: '#FFFFFF', borderColor: '#E5E9E0', borderWidth: 1, borderRadius: 18 } as const;
const green = '#55765D'; const ink = '#26372D'; const muted = '#727C70';
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Never';
const statusColor = (status: string) => status === 'verified' ? green : status === 'suspended' ? '#A34F3E' : '#A87535';

function Metric({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: React.ComponentType<any> }) {
  return <View style={{ ...panel, padding: 15, flexGrow: 1, flexBasis: 155, minWidth: 135 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: muted, fontSize: 10, fontWeight: '800' }}>{label}</Text><Icon size={16} color={green} /></View>
    <Text style={{ color: ink, fontSize: 25, fontWeight: '900', marginTop: 8 }}>{value.toLocaleString()}</Text>
    <Text style={{ color: muted, fontSize: 9, marginTop: 3 }}>{detail}</Text>
  </View>;
}

export default function UserManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [summary, setSummary] = useState<Payload['summary']>({ total: 0, active30d: 0, verified: 0, unverified: 0, suspended: 0 });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'verified' | 'unverified' | 'suspended'>('all');
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyUserId, setBusyUserId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (nextPage = page, quiet = false) => {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); return; }
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const { data, error: requestError } = await supabase.functions.invoke('admin-users', {
        body: { action: 'list', page: nextPage, perPage: 50 },
      });
      if (requestError) throw requestError;
      if (!data || data.error) throw new Error(data?.error || 'Could not load users.');
      const payload = data as Payload;
      setUsers(payload.users || []); setActivity(payload.activity || []);
      setSummary(payload.summary); setPage(payload.page); setTotalPages(payload.totalPages);
      setSelected((current) => current ? (payload.users || []).find((user) => user.id === current.id) || null : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load registered users.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [page]);

  useEffect(() => { void load(1); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch = !q || [user.full_name, user.email, user.phone, user.station?.name, user.station?.woreda, user.id].some((value) => value?.toLowerCase().includes(q));
      return matchesSearch && (filter === 'all' || user.status === filter);
    });
  }, [users, search, filter]);

  const updateStatus = async (user: ManagedUser) => {
    const action = user.status === 'suspended' ? 'reactivate' : 'suspend';
    setBusyUserId(user.id); setError(''); setNotice('');
    try {
      const { data, error: requestError } = await supabase!.functions.invoke('admin-users', { body: { action, userId: user.id } });
      if (requestError) throw requestError;
      if (!data?.success) throw new Error(data?.error || 'Account status could not be changed.');
      setNotice(action === 'suspend' ? 'User account suspended.' : 'User account reactivated.');
      await load(page, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update this account.');
    } finally { setBusyUserId(''); }
  };

  const button = { borderWidth: 1, borderColor: '#DDE4DA', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 };
  return <View style={{ gap: 15 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <View style={{ flex: 1 }}><Text style={{ color: ink, fontSize: 18, fontWeight: '900' }}>User management</Text><Text style={{ color: muted, fontSize: 11, marginTop: 4 }}>Monitor registered accounts, station associations, sign-ins and assessment activity.</Text></View>
      <Pressable onPress={() => void load(page, true)} disabled={refreshing} style={button}><RefreshCw size={14} color={green} /><Text style={{ color: green, fontSize: 10, fontWeight: '800' }}>{refreshing ? 'Refreshing' : 'Refresh'}</Text></Pressable>
    </View>
    {error ? <View style={{ ...panel, padding: 12, borderColor: '#E7BDB3', backgroundColor: '#FBF0ED' }}><Text style={{ color: '#7D3C32', fontSize: 11 }}>{error}</Text></View> : null}
    {notice ? <View style={{ ...panel, padding: 12, borderColor: '#C9D9C7', backgroundColor: '#EFF5ED' }}><Text style={{ color: green, fontSize: 11, fontWeight: '800' }}>{notice}</Text></View> : null}
    {loading ? <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator size="large" color={green} /><Text style={{ color: muted, marginTop: 10, fontSize: 11 }}>Loading registered users…</Text></View> : <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Metric label="All accounts" value={summary.total} detail="Registered in Supabase Auth" icon={Users} />
        <Metric label="Active in 30 days" value={summary.active30d} detail="Based on last sign-in" icon={Activity} />
        <Metric label="Verified" value={summary.verified} detail="Email or phone confirmed" icon={CheckCircle2} />
        <Metric label="Unverified" value={summary.unverified} detail="Awaiting confirmation" icon={Clock3} />
        <Metric label="Suspended" value={summary.suspended} detail="Access currently blocked" icon={ShieldAlert} />
      </View>

      <View style={{ ...panel, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Search size={16} color="#899187" /><TextInput value={search} onChangeText={setSearch} placeholder="Search name, email, phone, station or user ID" placeholderTextColor="#9AA298" style={{ flex: 1, padding: 8, color: ink, outlineStyle: 'none' as any }} />
        {search ? <Pressable onPress={() => setSearch('')}><XCircle size={16} color={muted} /></Pressable> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {(['all', 'verified', 'unverified', 'suspended'] as const).map((value) => <Pressable key={value} onPress={() => setFilter(value)} style={{ borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: filter === value ? '#EAF1E8' : '#FFFFFF', borderWidth: 1, borderColor: filter === value ? green : '#E5E9E0' }}><Text style={{ color: filter === value ? green : muted, fontSize: 10, fontWeight: '800', textTransform: 'capitalize' }}>{value === 'all' ? 'All users' : value}</Text></Pressable>)}
      </View>
      <View style={{ ...panel, overflow: 'hidden' }}>
        {filtered.map((user, index) => <Pressable key={user.id} onPress={() => setSelected(user)} style={{ padding: 14, borderBottomWidth: index === filtered.length - 1 ? 0 : 1, borderColor: '#EEF0EC', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 39, height: 39, borderRadius: 14, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center' }}><UserRound size={18} color={green} /></View>
          <View style={{ flex: 1, minWidth: 100 }}><Text style={{ color: ink, fontSize: 12, fontWeight: '900' }}>{user.full_name || user.email || 'Unnamed user'}</Text><Text style={{ color: muted, fontSize: 10, marginTop: 3 }}>{user.email || user.phone || user.id}</Text><Text style={{ color: muted, fontSize: 9, marginTop: 2 }}>{user.station?.name || 'No station linked'}{user.station?.woreda ? ' · ' + user.station.woreda : ''}</Text></View>
          <View style={{ alignItems: 'flex-end', gap: 5 }}><Text style={{ color: statusColor(user.status), fontSize: 9, fontWeight: '900', textTransform: 'uppercase' }}>{user.status}</Text><Text style={{ color: muted, fontSize: 9 }}> {user.batch_count} batches</Text></View>
          <ChevronRight size={15} color="#9AA298" />
        </Pressable>)}
        {!filtered.length ? <Text style={{ color: muted, padding: 20, fontSize: 11 }}>No users match the current search or filter.</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable disabled={page <= 1} onPress={() => void load(page - 1)} style={{ ...button, opacity: page <= 1 ? 0.4 : 1 }}><ChevronLeft size={14} color={green} /><Text style={{ color: green, fontSize: 10, fontWeight: '800' }}>Previous</Text></Pressable>
        <Text style={{ color: muted, fontSize: 10 }}>Page {page} of {totalPages}</Text>
        <Pressable disabled={page >= totalPages} onPress={() => void load(page + 1)} style={{ ...button, opacity: page >= totalPages ? 0.4 : 1 }}><Text style={{ color: green, fontSize: 10, fontWeight: '800' }}>Next</Text><ChevronRight size={14} color={green} /></Pressable>
      </View>

      <View style={{ gap: 10 }}>
        <Text style={{ color: ink, fontSize: 16, fontWeight: '900' }}>Recent user activity</Text>
        <Text style={{ color: muted, fontSize: 10 }}>Sign-ins, registrations and coffee assessment submissions recorded by the app.</Text>
        <View style={{ ...panel, overflow: 'hidden' }}>
          {activity.map((item, index) => {
            const actor = users.find((user) => user.id === item.user_id);
            const label = item.event_type.replaceAll('_', ' ');
            return <View key={item.id} style={{ padding: 12, borderBottomWidth: index === activity.length - 1 ? 0 : 1, borderColor: '#EEF0EC' }}>
              <Text style={{ color: ink, fontSize: 10, fontWeight: '800', textTransform: 'capitalize' }}>{label}</Text>
              <Text style={{ color: muted, fontSize: 9, marginTop: 3 }}>{actor?.email || item.user_id} · {dateLabel(item.created_at)}</Text>
            </View>;
          })}
          {!activity.length ? <Text style={{ color: muted, padding: 15, fontSize: 10 }}>No activity events recorded yet. Events will appear after the updated app is deployed.</Text> : null}
        </View>
      </View>
    </>}
    {selected ? <View style={{ ...panel, padding: 17, gap: 11 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ color: ink, fontSize: 16, fontWeight: '900' }}>User details</Text><Pressable onPress={() => setSelected(null)}><XCircle size={18} color={muted} /></Pressable></View>
      <Text style={{ color: ink, fontSize: 14, fontWeight: '800' }}>{selected.full_name || 'Unnamed user'}</Text>
      <Text style={{ color: muted, fontSize: 11 }}>{selected.email || 'No email'} · {selected.phone || 'No phone'}</Text>
      <Text style={{ color: muted, fontSize: 10 }}>User ID: {selected.id}</Text>
      <Text style={{ color: muted, fontSize: 10 }}>Registered: {dateLabel(selected.created_at)}</Text>
      <Text style={{ color: muted, fontSize: 10 }}>Last sign-in: {dateLabel(selected.last_sign_in_at)}</Text>
      <Text style={{ color: muted, fontSize: 10 }}>Station: {selected.station?.name || 'Not linked'}{selected.station?.woreda ? ' · ' + selected.station.woreda : ''}</Text>
      <Text style={{ color: muted, fontSize: 10 }}>Coffee assessments: {selected.batch_count}</Text>
      <Text style={{ color: muted, fontSize: 10 }}>Role: {selected.role}</Text>
      {selected.role !== 'admin' ? <Pressable disabled={busyUserId === selected.id} onPress={() => void updateStatus(selected)} style={{ backgroundColor: selected.status === 'suspended' ? green : '#A34F3E', borderRadius: 11, padding: 12, alignItems: 'center', opacity: busyUserId === selected.id ? 0.6 : 1 }}><Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900' }}>{busyUserId === selected.id ? 'Updating…' : selected.status === 'suspended' ? 'Reactivate account' : 'Suspend account'}</Text></Pressable> : <Text style={{ color: muted, fontSize: 10 }}>Administrator accounts are protected from suspension in this module.</Text>}
    </View> : null}
  </View>;
}
