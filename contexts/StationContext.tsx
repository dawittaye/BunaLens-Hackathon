import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { CoffeeBatch, Station } from '@/types';
import { getDemoAssessment } from '@/constants/demoSamples';
import { priceAssessment } from '@/services/pricing';
import { supabase } from '@/services/supabaseClient';

const STORAGE_KEYS = ['bunalens.station', 'bunalens.batches'] as const;
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
  setStation: (station: Station) => void;
  addBatch: (batch: CoffeeBatch) => void;
  addCredits: (amount: number) => void;
  consumeCredit: () => boolean;
}

const StationContext = createContext<StationContextValue | null>(null);

export function StationProvider({ children }: { children: React.ReactNode }) {
  const [station, setStationState] = useState<Station>(seed);
  const [batches, setBatches] = useState<CoffeeBatch[]>([]);

  useEffect(() => {
    let active = true;
    AsyncStorage.multiGet([...STORAGE_KEYS])
      .then(async (values) => {
        if (!active) return;
        const stationValue = values[0]?.[1];
        const batchesValue = values[1]?.[1];
        if (stationValue) {
          try { setStationState(JSON.parse(stationValue) as Station); } catch { /* retain demo defaults */ }
        }
        if (batchesValue) {
          try { setBatches(JSON.parse(batchesValue) as CoffeeBatch[]); } catch { /* retain empty history */ }
        } else if (!stationValue || (() => { try { return (JSON.parse(stationValue) as Station).id === 'station-demo'; } catch { return true; } })()) {
          // First-run sample records are explicitly marked DEMO and excluded from live AI metrics.
          const now = Date.now();
          const demoBatches: CoffeeBatch[] = [
            { id: 'demo-seed-clean', batch_code: 'BNL-JMA-DEMO1', sample_type: 'green_bean', woreda: 'Gomma', created_at: new Date(now - 86400000).toISOString(), result: getDemoAssessment(false, 'green_bean'), lot_weight_kg: 170, status: 'demo', station_id: 'station-demo', pricing: priceAssessment('green_bean', 'Grade 1', 170), verification_id: 'demo-seed-clean' },
            { id: 'demo-seed-defective', batch_code: 'BNL-JMA-DEMO2', sample_type: 'red_cherry', woreda: 'Limmu Kossa', created_at: new Date(now - 43200000).toISOString(), result: getDemoAssessment(true, 'red_cherry'), lot_weight_kg: 170, status: 'demo', station_id: 'station-demo', pricing: priceAssessment('red_cherry', 'Grade 3', 170), verification_id: 'demo-seed-defective' },
          ];
          setBatches(demoBatches);
          await AsyncStorage.setItem(STORAGE_KEYS[1], JSON.stringify(demoBatches));
        }
      })
      .then(async () => {
        if (!active || !supabase) return;
        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData.session?.user;
        if (!user || !active) return;
        const { data: remoteStation, error } = await supabase
          .from('stations')
          .select('id,name,manager,woreda,credits,pro_expires_at')
          .eq('owner_id', user.id)
          .limit(1)
          .maybeSingle();
        if (error || !remoteStation || !active) return;
        const hydrated: Station = {
          id: remoteStation.id,
          name: remoteStation.name || 'My Coffee Station',
          manager: remoteStation.manager || 'Station Manager',
          woreda: remoteStation.woreda,
          credits: remoteStation.credits,
          feresula_price_etb: seed.feresula_price_etb,
          pro_expires_at: remoteStation.pro_expires_at || undefined,
        };
        setStationState(hydrated);
        await AsyncStorage.setItem(STORAGE_KEYS[0], JSON.stringify(hydrated));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const setStation = (next: Station) => {
    setStationState(next);
    void AsyncStorage.setItem(STORAGE_KEYS[0], JSON.stringify(next));
  };

  const addBatch = (batch: CoffeeBatch) => {
    setBatches((current) => {
      const next = [batch, ...current.filter((item) => item.id !== batch.id)];
      void AsyncStorage.setItem(STORAGE_KEYS[1], JSON.stringify(next));
      return next;
    });
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
    [station, batches],
  );

  return <StationContext.Provider value={value}>{children}</StationContext.Provider>;
}

export function useStation(): StationContextValue {
  const value = useContext(StationContext);
  if (!value) throw new Error('useStation must be used inside StationProvider.');
  return value;
}
