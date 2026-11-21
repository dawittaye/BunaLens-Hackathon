export const BunaLensTheme = {
  colors: {
    espresso: '#26372D',
    cherry: '#A34F3E',
    emerald: '#55765D',
    harvest: '#B7834D',
    parchment: '#F5F6EF',
    surface: '#FFFFFF',
    line: '#E5E9E0',
    secondary: '#727C70',
    muted: '#A3AA9F',
    cherrySoft: '#F7EAE5',
    emeraldSoft: '#EAF1E8',
    harvestSoft: '#F6EFE3',
  },
  radius: { card: 22, control: 14, pill: 999 },
  spacing: { screen: 20, section: 28, card: 18 },
  typography: {
    display: 34,
    heading: 23,
    subheading: 16,
    body: 14,
    caption: 11,
  },
} as const;

export type BunaLensColor = keyof typeof BunaLensTheme.colors;
