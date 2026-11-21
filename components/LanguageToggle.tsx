import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Languages } from 'lucide-react-native';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';

export default function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  const { theme } = useTheme();
  const next = language === 'en' ? 'om' : language === 'om' ? 'am' : 'en';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={language === 'en' ? 'Switch to Afaan Oromo' : language === 'om' ? 'Switch to Amharic' : 'Switch to English'}
      accessibilityHint="Changes the application language and saves your choice"
      onPress={() => setLanguage(next)}
      className="flex-row items-center rounded-full border px-3.5 py-2"
      style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line, minHeight: 38 }}
    >
      <Languages size={14} color={theme.colors.espresso} />
      <Text className="text-xs font-extrabold ml-1.5" style={{ color: theme.colors.espresso }}>{language === 'en' ? 'OM' : language === 'om' ? 'አማ' : 'EN'}</Text>
    </Pressable>
  );
}
