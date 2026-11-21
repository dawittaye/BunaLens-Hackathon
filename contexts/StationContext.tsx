import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CoffeeBatch, Station } from '@/types';
import { getDemoAssessment } from '@/constants/demoSamples';
import { priceAssessment } from '@/services/pricing';
import { supabase } from '@/services/supabaseClient';

function storageKeys(owner: string | null) {
  const scope = owner ?? 'demo';
  return ['bunalens.station.' + scope, 'bunalens.batches.' + scope] as const;
}

function readCache<T>(serialized: string | null | undefined): T | undefined {
  try { return serialized ? JSON.parse(serialized) as T : undefined; }
  catch { return undefined; }
}

function createDemoBatches(): CoffeeBatch[] {
  const now = Date.now();
  return [
    { id: 'demo-seed-clean', batch_code: 'BNL-JMA-DEMO1', sample_type: 'green_bean', woreda: 'Gomma', created_at: new Date(now - 86400000).toISOString(), result: getDemoAssessment(false, 'green_bean'), lot_weight_kg: 170, status: 'demo', station_id: 'station-demo', pricing: priceAssessment('green_bean', 'Grade 1', 170), verification_id: 'demo-seed-clean' },
    { id: 'demo-seed-defective', batch_code: 'BNL-JMA-DEMO2', sample_type: 'red_cherry', woreda: 'Limmu Kossa', created_at: new Date(now - 43200000).toISOString(), result: getDemoAssessment(true, 'red_cherry'), lot_weight_kg: 170, status: 'demo', station_id: 'station-demo', pricing: priceAssessment('red_cherry', 'Grade 3', 170), verification_id: 'demo-seed-defective' },
  ];
}
const seed: Station = {
  id: 'station-demo',
  name: 'Gomma Coffee Washing Station',
  woreda: 'Gomma',
  manager: 'Station Manager',
  credits: 10,
  feresula_price_etb: 6200,
};

interface StationContextValue {
  station: Station;
  batches: CoffeeBatch[];
  setStation: (station: Station, owner?: string) => void;
  addBatch: (batch: CoffeeBatch) => void;
  addCredits: (amount: number) => void;
  consumeCredit: () => boolean;
}

const StationContext = createContext<StationContextValue | null>(null);

export function StationProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState<string | null | undefined>(supabase ? undefined : null);
  const currentScope = useRef(scope);
  const [cacheReady, setCacheReady] = useState<string | null | undefined>(undefined);
  const [station, setStationState] = useState<Station>(seed);
  const [batches, setBatches] = useState<CoffeeBatch[]>([]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      const nextScope = session?.user.id ?? null;
      if (currentScope.current === nextScope) return;
      currentScope.current = nextScope;
      setCacheReady(undefined);
      setStationState(seed);
      setBatches([]);
      setScope(nextScope);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (scope === undefined) return;
    let active = true;
    const loadCache = async () => {
      const keys = storageKeys(scope);
      const values = await AsyncStorage.multiGet(keys);
      const stationValue = values[0]?.[1];
      const batchesValue = values[1]?.[1];
      if (!active || currentScope.current !== scope) return;
      const cachedStation = readCache<Station>(stationValue);
      if (cachedStation) setStationState(current => current === seed ? cachedStation : current);
      const cachedBatches = readCache<CoffeeBatch[]>(batchesValue);
      const initial = cachedBatches ?? (scope === null ? createDemoBatches() : []);
      setBatches(current => [...current, ...initial.filter(batch => !current.some(row => row.id === batch.id))]);
    };
    void loadCache().catch(() => undefined).finally(() => {
      if (active && currentScope.current === scope) setCacheReady(scope);
    });
    return () => { active = false; };
  }, [scope]);

  useEffect(() => {
    const client = supabase;
    if (!client || !scope || cacheReady !== scope) return;
    let active = true;
    const loadStation = async () => {
      const { data, error } = await client.from('stations')
        .select('id,name,manager,woreda,credits,pro_expires_at')
        .eq('owner_id', scope).limit(1).maybeSingle();
      if (error || !data || !active || currentScope.current !== scope) return;
      setStationState(current => ({
        ...(current.id === data.id ? current : seed),
        id: data.id,
        name: data.name || 'My Coffee Station',
        manager: data.manager || 'Station Manager',
        woreda: data.woreda,
        credits: data.credits,
        pro_expires_at: data.pro_expires_at || undefined,
      }));
    };
    void loadStation();
    return () => { active = false; };
  }, [scope, cacheReady]);

  useEffect(() => {
    if (scope === undefined || cacheReady !== scope || currentScope.current !== scope) return;
    const [stationKey, batchesKey] = storageKeys(scope);
    void AsyncStorage.multiSet([[stationKey, JSON.stringify(station)], [batchesKey, JSON.stringify(batches)]])
      .catch(() => undefined);
  }, [scope, cacheReady, station, batches]);

  const stationId = station.id;
  useEffect(() => {
    const client = supabase;
    if (!client || !scope || cacheReady !== scope || stationId === seed.id) return;
    let active = true;
    let revision = 0;
    const refreshCloudBatches = async () => {
      const request = ++revision;
      const { data: cloudRows, error } = await client.from('coffee_batches')
        .select('id,batch_code,sample_type,woreda,created_at,image_path,gps_latitude,gps_longitude,latitude,longitude,lot_weight_kg,grading_result,pricing_result,verification_id,station_id,is_demo')
        .eq('station_id', stationId).order('created_at', { ascending: false }).limit(500);
      if (error || !cloudRows || !active || currentScope.current !== scope || request !== revision) return;
      const cloudBatches: CoffeeBatch[] = cloudRows.map((row) => ({
      id: row.id,
      batch_code: row.batch_code,
      sample_type: row.sample_type,
      woreda: row.woreda,
      created_at: row.created_at,
      image_path: row.image_path || undefined,
      origin_coordinates: (row.gps_latitude ?? row.latitude) != null && (row.gps_longitude ?? row.longitude) != null &&
        Number.isFinite(Number(row.gps_latitude ?? row.latitude)) && Number.isFinite(Number(row.gps_longitude ?? row.longitude))
        ? { latitude: Number(row.gps_latitude ?? row.latitude), longitude: Number(row.gps_longitude ?? row.longitude) }
        : undefined,
      result: row.grading_result,
      lot_weight_kg: Number(row.lot_weight_kg),
      status: row.is_demo ? 'demo' : 'synced',
      station_id: row.station_id,
      pricing: row.pricing_result || undefined,
      verification_id: row.verification_id || undefined,
    }));
      const cloudIds = new Set(cloudBatches.map(batch => batch.id));
      setBatches(current => [
        ...cloudBatches,
        ...current.filter(batch => batch.station_id === stationId && batch.status !== 'synced' && !cloudIds.has(batch.id)),
      ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
    };
    void refreshCloudBatches().catch(() => undefined);
    const channel = client.channel('coffee-batches-' + stationId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coffee_batches', filter: 'station_id=eq.' + stationId },
        () => { void refreshCloudBatches().catch(() => undefined); })
      .subscribe();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [scope, cacheReady, stationId]);

  const setStation = (next: Station, owner = scope) => {
    if (owner !== undefined && owner === currentScope.current) setStationState(next);
  };

  const addBatch = (batch: CoffeeBatch) => {
    if (scope === undefined || scope !== currentScope.current || batch.station_id !== stationId) return;
    setBatches(current => [batch, ...current.filter(item => item.id !== batch.id)]);
  };

  const addCredits = (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    setStation({ ...station, credits: station.credits + Math.floor(amount) });
  };

  const consumeCredit = () => {
    if (station.credits < 1) return false;
    setStation({ ...station, credits: station.credits - 1 });
    return true;
  };

  const value = useMemo(
    () => ({ station, batches, setStation, addBatch, addCredits, consumeCredit }),
    [station, batches, scope],
  );

  return <StationContext.Provider value={value}>{children}</StationContext.Provider>;
}

export function useStation(): StationContextValue {
  const value = useContext(StationContext);
  if (!value) throw new Error('useStation must be used inside StationProvider.');
  return value;
}
