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
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingCodes, setPendingCodes] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const mounted = useRef(true);
  const lock = useRef(false);

  const refresh = useCallback(async () => {
    const [connected, queue] = await Promise.all([isOnline(), getQueue()]);
    if (mounted.current) {
      setOnline(connected);
      setPendingCount(queue.length);
      setPendingCodes(queue.map((item) => item.batch_code || item.id).slice(0, 3));
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setSyncing(true);
    try {
      const result = await syncQueuedCaptures();
      result.synced.forEach((batch: CoffeeBatch) => {
        addBatch(batch);
        if (!(station.pro_expires_at && new Date(station.pro_expires_at).getTime() > Date.now())) consumeCredit();
      });
      if (mounted.current) setPendingCount(result.remaining);
      if (result.synced.length > 0) showAlert('Sync complete', result.synced.length + ' queued sample(s) synchronized.');
    } catch (error) {
      showAlert('Sync unavailable', error instanceof Error ? error.message : 'Could not synchronize queued samples. Your local copies remain saved.');
    } finally {
      lock.current = false;
      if (mounted.current) setSyncing(false);
      await refresh();
    }
  }, [addBatch, consumeCredit, refresh, station]);

  useEffect(() => {
    mounted.current = true;
    let previousOnline = false;
    void refresh().then(async () => {
      const connected = await isOnline();
      previousOnline = connected;
      if (connected && (await getQueue()).length > 0) void syncNow();
    });
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
      const reconnected = connected && !previousOnline;
      previousOnline = connected;
      if (mounted.current) setOnline(connected);
      void refresh();
      if (reconnected) void getQueue().then((queue) => { if (queue.length > 0) void syncNow(); });
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, [refresh, syncNow]);

  const value = useMemo(() => ({ online, pendingCount, pendingCodes, syncing, refresh, syncNow }), [online, pendingCount, pendingCodes, syncing, refresh, syncNow]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOfflineQueue() {
  const value = useContext(Context);
  if (!value) throw new Error('OfflineQueueProvider is missing from the app tree.');
  return value;
}
