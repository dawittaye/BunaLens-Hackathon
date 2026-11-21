import React from 'react';
import { Tabs } from 'expo-router';
import { Home, ScanLine, Layers3, Warehouse } from 'lucide-react-native';
import { View, Text } from 'react-native';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';

function TabItem({ icon: Icon, label, focused, accent = false }: { icon: React.ComponentType<any>; label: string; focused: boolean; accent?: boolean }) {
  const { theme } = useTheme();
  if (accent) {
    return (
      <View className="items-center justify-center" style={{ width: 68, marginTop: -12 }}>
        <View className="items-center justify-center" style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.emerald, borderWidth: 4, borderColor: theme.colors.parchment, shadowColor: theme.colors.espresso, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5 }}>
          <ScanLine color="#FFFFFF" size={22} strokeWidth={1.9} />
        </View>
        <Text style={{ color: theme.colors.emerald, fontSize: 9, fontWeight: '800', marginTop: 2 }}>{label}</Text>
      </View>
    );
  }
  return (
    <View className="items-center justify-center" style={{ minWidth: 56, paddingTop: 7 }}>
      <Icon color={focused ? theme.colors.emerald : theme.colors.secondary} size={19} strokeWidth={focused ? 2.2 : 1.8} />
      <Text numberOfLines={1} style={{ color: focused ? theme.colors.emerald : theme.colors.secondary, fontSize: 10, fontWeight: focused ? '800' : '600', marginTop: 5 }}>{label}</Text>
      <View style={{ width: focused ? 15 : 4, height: 2, borderRadius: 2, backgroundColor: focused ? theme.colors.emerald : 'transparent', marginTop: 4 }} />
    </View>
  );
}

export default function TabLayout() {
  const { t } = useLanguage();
  const { theme } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: theme.colors.emerald,
        tabBarInactiveTintColor: theme.colors.secondary,
        tabBarStyle: {
          height: 78,
          paddingTop: 8,
          paddingBottom: 10,
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.line,
          borderTopWidth: 1,
          elevation: 6,
          shadowColor: theme.colors.espresso,
          shadowOpacity: 0.04,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -3 },
        },
        tabBarItemStyle: { paddingVertical: 0 },
      }}
    >
      <Tabs.Screen name="index" options={{ tabBarAccessibilityLabel: 'Home', tabBarIcon: ({ focused }) => <TabItem icon={Home} label={t('home')} focused={focused} /> }} />
      <Tabs.Screen name="scan" options={{ tabBarAccessibilityLabel: t('scan'), tabBarIcon: () => <TabItem icon={ScanLine} label={t('scan')} focused accent /> }} />
      <Tabs.Screen name="batches" options={{ tabBarAccessibilityLabel: 'Batch history', tabBarIcon: ({ focused }) => <TabItem icon={Layers3} label={t('batches')} focused={focused} /> }} />
      <Tabs.Screen name="station" options={{ tabBarAccessibilityLabel: 'Washing station', tabBarIcon: ({ focused }) => <TabItem icon={Warehouse} label={t('station')} focused={focused} /> }} />
    </Tabs>
  );
}
