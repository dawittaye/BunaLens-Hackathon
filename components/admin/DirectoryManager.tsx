import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { CircleAlert, Plus, RefreshCw, X } from 'lucide-react-native';
import { supabase } from '@/services/supabaseClient';

type Woreda = { id: string; name: string; zone: string; is_active: boolean };
type DirectoryStation = { id: string; name: string; woreda_id: string; is_active: boolean; created_at: string };

const panel = { backgroundColor: '#FFFFFF', borderColor: '#E5E9E0', borderWidth: 1, borderRadius: 18 } as const;
const green = '#55765D';
const ink = '#26372D';
const muted = '#727C70';

export default function DirectoryManager() {
  const [woredas, setWoredas] = useState<Woreda[]>([]);
  const [directoryStations, setDirectoryStations] = useState<DirectoryStation[]>([]);
  const [selectedWoreda, setSelectedWoreda] = useState('');
  const [newWoreda, setNewWoreda] = useState('');
  const [newStation, setNewStation] = useState('');
  const [zone, setZone] = useState('Jimma');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [woredaResult, stationResult] = await Promise.all([
        supabase.from('woredas').select('id,name,zone,is_active').order('name'),
        supabase.from('station_directory').select('id,name,woreda_id,is_active,created_at').order('name'),
      ]);
      if (woredaResult.error) throw woredaResult.error;
      if (stationResult.error) throw stationResult.error;
      const nextWoredas = (woredaResult.data ?? []) as Woreda[];
      setWoredas(nextWoredas);
      setDirectoryStations((stationResult.data ?? []) as DirectoryStation[]);
      setSelectedWoreda((current) => nextWoredas.some((item) => item.id === current && item.is_active) ? current : (nextWoredas.find((item) => item.is_active)?.id ?? ''));
    } catch (e) {
      console.warn('BunaLens directory could not be loaded', (e as { code?: string })?.code);
      setError('Could not load the directory. Check your admin access and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeWoredas = useMemo(() => woredas.filter((item) => item.is_active), [woredas]);
  const groupedStations = useMemo(() => woredas.map((woreda) => ({
    woreda,
    stations: directoryStations.filter((station) => station.woreda_id === woreda.id),
  })), [woredas, directoryStations]);

  const addWoreda = async () => {
    const name = newWoreda.trim();
    if (!name) { setError('Enter a woreda name first.'); return; }
    if (!supabase) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const { error: insertError } = await supabase.from('woredas').insert({ name, zone: zone.trim() || 'Jimma' });
      if (insertError) throw insertError;
      setNewWoreda('');
      setNotice('Woreda added.');
      await load(true);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setError(code === '23505' ? 'That woreda already exists.' : 'Could not add the woreda. Check the name and try again.');
    } finally { setSaving(false); }
  };

  const addStation = async () => {
    const name = newStation.trim();
    if (!name) { setError('Enter a station name first.'); return; }
    if (!selectedWoreda) { setError('Select an active woreda first.'); return; }
    if (!supabase) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const { error: insertError } = await supabase.from('station_directory').insert({ name, woreda_id: selectedWoreda });
      if (insertError) throw insertError;
      setNewStation('');
      setNotice('Station added to the directory.');
      await load(true);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setError(code === '23505' ? 'That station already exists in this woreda.' : 'Could not add the station. Check the selected woreda and try again.');
    } finally { setSaving(false); }
  };

  const toggleWoreda = async (item: Woreda) => {
    if (!supabase) return;
    setError(''); setNotice('');
    const { error: updateError } = await supabase.from('woredas').update({ is_active: !item.is_active }).eq('id', item.id);
    if (updateError) { setError('Could not update the woreda status.'); return; }
    setNotice(`Woreda ${item.is_active ? 'deactivated' : 'activated'}.`);
    await load(true);
  };

  const toggleStation = async (item: DirectoryStation) => {
    if (!supabase) return;
    setError(''); setNotice('');
    const { error: updateError } = await supabase.from('station_directory').update({ is_active: !item.is_active }).eq('id', item.id);
    if (updateError) { setError('Could not update the station status.'); return; }
    setNotice(`Station ${item.is_active ? 'deactivated' : 'activated'}.`);
    await load(true);
  };

  const inputStyle = { borderWidth: 1, borderColor: '#E5E9E0', borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, color: ink, backgroundColor: '#FFFFFF', fontSize: 13 } as const;
  const primaryButton = { backgroundColor: '#26372D', borderRadius: 11, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 7 };
  const secondaryButton = { borderWidth: 1, borderColor: '#DDE4DA', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: ink, fontSize: 18, fontWeight: '900' }}>Location directory</Text>
          <Text style={{ color: muted, fontSize: 11, marginTop: 4 }}>Manage the woredas and coffee stations available during registration.</Text>
        </View>
        <Pressable onPress={() => void load(true)} disabled={refreshing} style={secondaryButton}>
          <RefreshCw size={14} color={green} />
          <Text style={{ color: green, fontSize: 10, fontWeight: '800' }}>{refreshing ? 'Refreshing' : 'Refresh'}</Text>
        </Pressable>
      </View>

      {error ? <View style={{ ...panel, borderColor: '#E7BDB3', backgroundColor: '#FBF0ED', padding: 13, flexDirection: 'row', gap: 8, alignItems: 'center' }}><CircleAlert size={16} color="#A34F3E" /><Text style={{ color: '#7D3C32', fontSize: 11, flex: 1 }}>{error}</Text><Pressable onPress={() => setError('')}><X size={15} color="#A34F3E" /></Pressable></View> : null}
      {notice ? <View style={{ ...panel, borderColor: '#C9D9C7', backgroundColor: '#EFF5ED', padding: 12 }}><Text style={{ color: green, fontSize: 11, fontWeight: '800' }}>{notice}</Text></View> : null}

      {loading ? <View style={{ padding: 42, alignItems: 'center' }}><ActivityIndicator size="large" color={green} /><Text style={{ color: muted, marginTop: 10, fontSize: 11 }}>Loading directory…</Text></View> : <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <View style={{ ...panel, flex: 1, minWidth: 130, padding: 15 }}><Text style={{ color: muted, fontSize: 10, fontWeight: '700' }}>Woredas</Text><Text style={{ color: ink, fontSize: 25, fontWeight: '900', marginTop: 5 }}>{woredas.length}</Text><Text style={{ color: muted, fontSize: 10 }}>{activeWoredas.length} active</Text></View>
          <View style={{ ...panel, flex: 1, minWidth: 130, padding: 15 }}><Text style={{ color: muted, fontSize: 10, fontWeight: '700' }}>Directory stations</Text><Text style={{ color: ink, fontSize: 25, fontWeight: '900', marginTop: 5 }}>{directoryStations.length}</Text><Text style={{ color: muted, fontSize: 10 }}>{directoryStations.filter((item) => item.is_active).length} active</Text></View>
        </View>

        <View style={{ ...panel, padding: 17, gap: 11 }}>
          <View><Text style={{ color: ink, fontSize: 15, fontWeight: '900' }}>Add a woreda</Text><Text style={{ color: muted, fontSize: 10, marginTop: 3 }}>Create a location that station owners can select during registration.</Text></View>
          <TextInput value={newWoreda} onChangeText={setNewWoreda} placeholder="Woreda name" placeholderTextColor="#9AA298" style={inputStyle} />
          <TextInput value={zone} onChangeText={setZone} placeholder="Zone" placeholderTextColor="#9AA298" style={inputStyle} />
          <Pressable onPress={() => void addWoreda()} disabled={saving} style={primaryButton}><Plus size={15} color="#FFFFFF" /><Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900' }}>{saving ? 'Saving…' : 'Add woreda'}</Text></Pressable>
        </View>

        <View style={{ ...panel, padding: 17, gap: 11 }}>
          <View><Text style={{ color: ink, fontSize: 15, fontWeight: '900' }}>Add a coffee station</Text><Text style={{ color: muted, fontSize: 10, marginTop: 3 }}>Each directory station must belong to one active woreda.</Text></View>
          <TextInput value={newStation} onChangeText={setNewStation} placeholder="Station name" placeholderTextColor="#9AA298" style={inputStyle} />
          <Text style={{ color: muted, fontSize: 10, fontWeight: '800' }}>SELECT WOREDA</Text>
          {activeWoredas.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {activeWoredas.map((item) => <Pressable key={item.id} onPress={() => setSelectedWoreda(item.id)} style={{ borderRadius: 99, borderWidth: 1, borderColor: selectedWoreda === item.id ? green : '#E5E9E0', backgroundColor: selectedWoreda === item.id ? '#EAF1E8' : '#FFFFFF', paddingHorizontal: 11, paddingVertical: 8 }}><Text style={{ color: selectedWoreda === item.id ? green : ink, fontSize: 10, fontWeight: '800' }}>{item.name}</Text></Pressable>)}
          </View> : <Text style={{ color: muted, fontSize: 11 }}>Add and activate a woreda before adding stations.</Text>}
          <Pressable onPress={() => void addStation()} disabled={saving || !activeWoredas.length} style={{ ...primaryButton, opacity: saving || !activeWoredas.length ? 0.55 : 1 }}><Plus size={15} color="#FFFFFF" /><Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900' }}>{saving ? 'Saving…' : 'Add station'}</Text></Pressable>
        </View>

        <View style={{ gap: 11 }}>
          <View><Text style={{ color: ink, fontSize: 17, fontWeight: '900' }}>Directory entries</Text><Text style={{ color: muted, fontSize: 10, marginTop: 3 }}>Deactivate entries to hide them from registration without deleting records.</Text></View>
          {groupedStations.map(({ woreda, stations }) => <View key={woreda.id} style={{ ...panel, overflow: 'hidden' }}>
            <View style={{ padding: 14, backgroundColor: '#F7F8F5', borderBottomWidth: 1, borderColor: '#EEF0EC', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}><Text style={{ color: ink, fontSize: 13, fontWeight: '900' }}>{woreda.name}</Text><Text style={{ color: muted, fontSize: 9, marginTop: 2 }}>{woreda.zone} zone · {stations.length} station{stations.length === 1 ? '' : 's'}</Text></View>
              <View style={{ backgroundColor: woreda.is_active ? '#EAF1E8' : '#F7EAE5', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 99 }}><Text style={{ color: woreda.is_active ? green : '#A34F3E', fontSize: 9, fontWeight: '900' }}>{woreda.is_active ? 'ACTIVE' : 'INACTIVE'}</Text></View>
              <Pressable onPress={() => void toggleWoreda(woreda)} style={secondaryButton}><Text style={{ color: green, fontSize: 9, fontWeight: '800' }}>{woreda.is_active ? 'Deactivate' : 'Activate'}</Text></Pressable>
            </View>
            {stations.map((item) => <View key={item.id} style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderColor: '#F0F2EE', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}><Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>{item.name}</Text><Text style={{ color: muted, fontSize: 9, marginTop: 3 }}>{item.is_active ? 'Visible during registration' : 'Hidden from registration'}</Text></View>
              <Pressable onPress={() => void toggleStation(item)} style={secondaryButton}><Text style={{ color: green, fontSize: 9, fontWeight: '800' }}>{item.is_active ? 'Deactivate' : 'Activate'}</Text></Pressable>
            </View>)}
            {!stations.length ? <Text style={{ color: muted, padding: 14, fontSize: 10 }}>No stations added to this woreda yet.</Text> : null}
          </View>)}
          {!woredas.length ? <View style={{ ...panel, padding: 20 }}><Text style={{ color: muted, fontSize: 11 }}>No woredas found. Add a woreda above to begin.</Text></View> : null}
        </View>
      </>}
    </View>
  );
}
