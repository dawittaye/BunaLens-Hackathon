import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark';
const palettes = {
  light: {
    espresso: '#26372D', cherry: '#A34F3E', emerald: '#55765D', harvest: '#B7834D',
    parchment: '#F5F6EF', surface: '#FFFFFF', line: '#E5E9E0', secondary: '#727C70',
    muted: '#A3AA9F', cherrySoft: '#F7EAE5', emeraldSoft: '#EAF1E8', harvestSoft: '#F6EFE3',
  },
  dark: {
    espresso: '#F1F4EF', cherry: '#E09A87', emerald: '#91B99A', harvest: '#D6AC78',
    parchment: '#151C18', surface: '#202A23', line: '#39463D', secondary: '#B2BDB3',
    muted: '#849187', cherrySoft: '#3B2A27', emeraldSoft: '#293B30', harvestSoft: '#3B3225',
  },
} as const;

type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  theme: { colors: typeof palettes.light | typeof palettes.dark };
};
const Context = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem('bunalens.theme')
      .then((stored) => { if (active && (stored === 'light' || stored === 'dark')) setModeState(stored); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const setMode = (value: ThemeMode) => {
    setModeState(value);
    void AsyncStorage.setItem('bunalens.theme', value).catch(() => undefined);
  };
  const value = useMemo(() => ({
    mode, isDark: mode === 'dark', setMode, theme: { colors: palettes[mode] },
  }), [mode]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTheme() {
  const value = useContext(Context);
  if (!value) throw new Error('ThemeProvider is missing from the app tree');
  return value;
}
