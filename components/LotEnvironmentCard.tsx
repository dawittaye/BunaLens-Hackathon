import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { isSupabaseConfigured } from '@/services/supabaseClient';
import { assignLotZone, fetchLotEnvironment, fetchWarehouseZones, type LotEnvironment, type WarehouseZone } from '@/services/lots';

const STATE_COPY: Record<LotEnvironment['state'], { label: string; color: string; background: string }> = {
  fresh: { label: 'Up to date', color: '#065F46', background: '#D1FAE5' },
  stale: { label: 'Stale reading', color: '#92400E', background: '#FEF3C7' },
  no_reading: { label: 'No reading yet', color: '#57534E', background: '#F5F5F4' },
  no_zone: { label: 'Not in a monitored zone', color: '#57534E', background: '#F5F5F4' },
  storage_ended: { label: 'Storage ended', color: '#57534E', background: '#F5F5F4' },
};

const formatTime = (value: string) => new Date(value).toLocaleString();

const formatAge = (minutes: number) => {
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return Math.round(minutes) + ' min ago';
  if (minutes < 1440) return (minutes / 60).toFixed(1) + ' h ago';
  return (minutes / 1440).toFixed(1) + ' days ago';
};

/**
 * Warehouse conditions for one lot: the latest reading captured while the lot
 * was stored in its zone. Readings from outside that interval are never shown.
 */
export default function LotEnvironmentCard({ batchId }: { batchId: string }) {
  const [environment, setEnvironment] = useState<LotEnvironment | null>(null);
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [busyZone, setBusyZone] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError('');
    try {
      const [nextEnvironment, nextZones] = await Promise.all([fetchLotEnvironment(batchId), fetchWarehouseZones()]);
      setEnvironment(nextEnvironment);
      setZones(nextZones);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Warehouse readings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { void load(); }, [load]);

  const store = async (zoneId: string) => {
    setBusyZone(zoneId);
    setError('');
    try {
      await assignLotZone(batchId, zoneId);
      await load();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'The lot could not be stored in that zone.');
    } finally {
      setBusyZone(null);
    }
  };

  const state = environment ? STATE_COPY[environment.state] : null;
  const reading = environment?.reading ?? null;
  const simulated = reading?.source === 'simulated' || environment?.device?.is_simulated === true;
  const otherZones = zones.filter((zone) => zone.id !== environment?.zone?.id || environment?.state === 'storage_ended');

  return (
    <View testID="lot-environment-card" className="bg-white border border-line p-4 rounded-xl mt-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-espresso font-black flex-1">Warehouse conditions</Text>
        {state ? (
          <View style={{ backgroundColor: state.background, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text testID="lot-environment-state" style={{ color: state.color, fontSize: 10, fontWeight: '800' }}>{state.label}</Text>
          </View>
        ) : null}
      </View>

      {!isSupabaseConfigured ? (
        <Text className="text-[11px] text-stone-500 mt-2 leading-5">Warehouse readings need a connected station account. They are not available in demonstration mode.</Text>
      ) : loading && !environment ? (
        <ActivityIndicator style={{ marginTop: 12 }} color="#7C2D12" />
      ) : null}

      {simulated ? (
        <View style={{ backgroundColor: '#FEF3C7', borderRadius: 8, padding: 8, marginTop: 10 }}>
          <Text testID="lot-environment-simulated" style={{ color: '#92400E', fontSize: 11, fontWeight: '800' }}>SIMULATED DATA — not from a physical sensor</Text>
        </View>
      ) : null}

      {reading ? (
        <>
          <View className="flex-row mt-3">
            <View className="w-1/2 pr-2">
              <Text className="text-[10px] text-stone-500">Air temperature</Text>
              <Text testID="lot-environment-temperature" className="text-2xl font-black text-espresso">{Number(reading.temperature_c).toFixed(1)} °C</Text>
            </View>
            <View className="w-1/2 pl-2">
              <Text className="text-[10px] text-stone-500">Relative humidity</Text>
              <Text testID="lot-environment-humidity" className="text-2xl font-black text-espresso">{Number(reading.humidity_pct).toFixed(1)} % RH</Text>
            </View>
          </View>
          <Text className="text-[11px] text-stone-600 mt-2">Captured {formatTime(reading.recorded_at)} ({formatAge(reading.age_minutes)})</Text>
          <Text className="text-[11px] text-stone-600 mt-1">Source: {reading.source === 'live' ? 'Live sensor' : 'Simulated'} · {environment?.device?.device_uid ?? 'device removed'} · {environment?.zone?.name}</Text>
          {environment?.state === 'stale' ? (
            <Text className="text-[11px] font-bold mt-2" style={{ color: '#92400E' }}>No reading for more than {environment.stale_after_minutes} minutes. Check the sensor power and network before relying on this value.</Text>
          ) : null}
          {environment?.state === 'storage_ended' ? (
            <Text className="text-[11px] text-stone-600 mt-2">This lot left the zone on {environment.storage?.released_at ? formatTime(environment.storage.released_at) : 'an unknown date'}. This is the last reading from its storage period.</Text>
          ) : null}
        </>
      ) : null}

      {environment?.state === 'no_reading' ? (
        <Text testID="lot-environment-missing" className="text-[11px] text-stone-600 mt-3 leading-5">
          Stored in {environment.zone?.name} since {environment.storage ? formatTime(environment.storage.assigned_at) : ''}. {environment.device ? 'The sensor ' + environment.device.device_uid + ' has not reported since then.' : 'This zone has no active sensor.'}
        </Text>
      ) : null}
      {environment?.state === 'no_zone' ? (
        <Text testID="lot-environment-missing" className="text-[11px] text-stone-600 mt-3 leading-5">This lot is not stored in a monitored zone, so no warehouse reading applies to it.</Text>
      ) : null}

      {environment && otherZones.length > 0 ? (
        <View className="mt-3 pt-3 border-t border-stone-100">
          <Text className="text-[10px] font-bold text-stone-500">{environment.zone && environment.state !== 'storage_ended' ? 'Move lot to' : 'Store lot in'}</Text>
          <View className="flex-row flex-wrap mt-1">
            {otherZones.map((zone) => (
              <Pressable key={zone.id} disabled={busyZone !== null} onPress={() => void store(zone.id)} className="bg-parchment rounded-full px-3 py-2 mr-2 mt-1">
                <Text className="text-espresso text-xs font-bold">{busyZone === zone.id ? 'Saving…' : zone.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {error ? <Text className="text-[11px] mt-2" style={{ color: '#B91C1C' }}>{error}</Text> : null}
      {environment ? (
        <View className="flex-row items-center justify-between mt-3">
          <Text className="text-[10px] text-stone-400 flex-1 pr-2 leading-4">{environment.note}</Text>
          <Pressable onPress={() => void load()} disabled={loading}><Text className="text-cherry text-xs font-bold">{loading ? 'Refreshing…' : 'Refresh'}</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}
