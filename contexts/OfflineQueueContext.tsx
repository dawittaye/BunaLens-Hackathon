import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import type { CoffeeBatch } from '@/types';
import { getQueue, isOnline, syncQueuedCaptures } from '@/services/offlineQueue';
import { showAlert } from '@/services/platformAlert';
import { useStation } from '@/contexts/StationContext';

interface OfflineQueueValue {
  online: boolean;
  pendingCount: number;
  pendingCodes: string[];
  syncing: boolean;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
}
const Context = createContext<OfflineQueueValue | null>(null);

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const { addBatch, consumeCredit, station } = useStation();
  const stationId = station.id;
  const activeStation = useRef(stationId);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState({ stationId, count: 0, codes: [] as string[] });
  const [syncing, setSyncing] = useState(false);
  const mounted = useRef(true);
  const lock = useRef(false);

  const refresh = useCallback(async () => {
    const [connected, queue] = await Promise.all([isOnline(), getQueue(stationId)]);
    if (mounted.current && activeStation.current === stationId) {
      setOnline(connected);
      setPending({ stationId, count: queue.length, codes: queue.map(item => item.batch_code || item.id).slice(0, 3) });
    }
  }, [stationId]);

  const syncNow = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setSyncing(true);
    try {
      const result = await syncQueuedCaptures(stationId);
      if (activeStation.current !== stationId) return;
      result.synced.forEach((batch: CoffeeBatch) => {
        addBatch(batch);
        if (!(station.pro_expires_at && new Date(station.pro_expires_at).getTime() > Date.now())) consumeCredit();
      });
      if (result.synced.length > 0) showAlert('Sync complete', result.synced.length + ' queued sample(s) synchronized.');
    } catch (error) {
      if (activeStation.current === stationId) showAlert('Sync unavailable', error instanceof Error ? error.message : 'Could not synchronize queued samples. Your local copies remain saved.');
    } finally {
      lock.current = false;
      if (mounted.current) setSyncing(false);
      await refresh();
    }
  }, [addBatch, consumeCredit, refresh, station, stationId]);

  useEffect(() => {
    mounted.current = true;
    activeStation.current = stationId;
    let previousOnline = false;
    void refresh().then(async () => {
      const connected = await isOnline();
      previousOnline = connected;
      if (stationId !== 'station-demo' && connected && (await getQueue(stationId)).length > 0) void syncNow();
    });
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
      const reconnected = connected && !previousOnline;
      previousOnline = connected;
      if (mounted.current) setOnline(connected);
      void refresh();
      if (stationId !== 'station-demo' && reconnected) void getQueue(stationId).then((queue) => { if (queue.length > 0) void syncNow(); });
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, [refresh, syncNow, stationId]);

  const value = useMemo(() => ({
    online, pendingCount: pending.stationId === stationId ? pending.count : 0,
    pendingCodes: pending.stationId === stationId ? pending.codes : [], syncing, refresh, syncNow,
  }), [online, pending, stationId, syncing, refresh, syncNow]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOfflineQueue() {
  const value = useContext(Context);
  if (!value) throw new Error('OfflineQueueProvider is missing from the app tree.');
  return value;
}
