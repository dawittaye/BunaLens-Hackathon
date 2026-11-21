import React, { useState } from 'react';
import { Modal, View, Text, Pressable, ActivityIndicator } from 'react-native';
import { CheckCircle2, CreditCard } from 'lucide-react-native';
import type { ChapaPackage } from '@/services/chapaService';
import { useLanguage } from '@/contexts/LanguageContext';

export default function ChapaTopUpModal({
  visible, onClose, onConfirm, busy = false, demoMode = false,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (packageId: ChapaPackage) => void;
  busy?: boolean;
  demoMode?: boolean;
}) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<ChapaPackage>('starter_50');
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-end">
        <View className="bg-parchment rounded-t-3xl p-5">
          <View className="flex-row items-center mb-2"><CreditCard size={19} color="#2C1810" /><Text className="text-espresso text-xl font-black ml-2">{t('stationCreditsTitle')}</Text></View>
          <Text className="text-stone-500 text-xs mb-4">{t('packageChoiceHint')}</Text>
          {([
            { id: 'starter_50' as const, title: t('starterPackName'), detail: t('starterPackDetails'), price: '500 ETB' },
            { id: 'station_pro_monthly' as const, title: t('proPlanName'), detail: t('proPlanDetails'), price: '2,500 ETB / month' },
          ]).map((item) => (
            <Pressable key={item.id} onPress={() => setSelected(item.id)} className={`rounded-2xl p-4 mb-3 border-2 flex-row items-center ${selected === item.id ? 'border-cherry bg-white' : 'border-line bg-white'}`}>
              <View className="flex-1"><Text className="text-espresso font-extrabold">{item.title}</Text><Text className="text-stone-500 text-xs mt-1">{item.detail}</Text><Text className="text-cherry font-black mt-2">{item.price}</Text></View>
              {selected === item.id ? <CheckCircle2 size={20} color="#B91C1C" /> : <View className="w-5 h-5 rounded-full border border-stone-300" />}
            </Pressable>
          ))}
          {demoMode ? <View className="bg-amber-50 border border-amber-200 p-3 rounded-xl mb-3"><Text className="text-amber-900 text-xs font-bold">{t('demoSandboxLabel')}</Text></View> : null}
          <Pressable disabled={busy} onPress={() => onConfirm(selected)} className="bg-cherry p-4 rounded-xl mt-1">{busy ? <ActivityIndicator color="white" /> : <Text className="text-white text-center font-bold">{demoMode ? t('simulateDemoPurchase') : t('continueChapa')}</Text>}</Pressable>
          <Pressable onPress={onClose} disabled={busy} className="p-3"><Text className="text-espresso text-center">{t('cancel')}</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}
