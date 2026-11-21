import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, TextInput, Image, Modal, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { attachDemoAssessment, fetchCloudLot } from '@/services/lots';
import { Camera, ImagePlus, ScanLine, Coffee, MapPin, Scale, Info, ShieldCheck, Zap, RotateCcw, ChevronRight } from 'lucide-react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStation } from '@/contexts/StationContext';
import { useOfflineQueue } from '@/contexts/OfflineQueueContext';
import { JIMMA_WOREDAS } from '@/constants/jimmaData';
import { getDemoAssessment } from '@/constants/demoSamples';
import type { CoffeeBatch, SampleType } from '@/types';
import { submitCoffeeSample } from '@/services/geminiVision';
import { enqueueCapture, isOnline, persistLocalImage } from '@/services/offlineQueue';
import { priceAssessment, KG_PER_FERESULA } from '@/services/pricing';
import { useTheme } from '@/contexts/ThemeContext';
import { showAlert } from '@/services/platformAlert';
import { logUserActivity } from '@/services/activityLogger';
import LanguageToggle from '@/components/LanguageToggle';

type Preview = { base64: string; uri: string; mimeType: string };

export default function Scan() {
  const { t, language } = useLanguage();
  const { theme } = useTheme();
  const { station, addBatch, consumeCredit } = useStation();
  const { refresh: refreshQueue } = useOfflineQueue();
  const [perm, ask] = useCameraPermissions();
  const [type, setType] = useState<SampleType>('green_bean');
  const [woreda, setWoreda] = useState(station.woreda);
  const [busy, setBusy] = useState(false);
  const [feresula, setFeresula] = useState('10');
  const [cam, setCam] = useState<CameraView | null>(null);
  const [flash, setFlash] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  // Sprint addition: when opened from a registered lot, the photo is saved on that lot.
  const { lotId } = useLocalSearchParams<{ lotId?: string }>();
  const [lot, setLot] = useState<CoffeeBatch | null>(null);
  useEffect(() => {
    let active = true;
    setLot(null);
    if (typeof lotId === 'string' && lotId) {
      void fetchCloudLot(lotId).then((found) => {
        if (!active || !found) return;
        setLot(found);
        setType(found.sample_type);
        setWoreda(found.woreda);
        setFeresula(String(Number((found.lot_weight_kg / KG_PER_FERESULA).toFixed(2))));
      });
    }
    return () => { active = false; };
  }, [lotId]);

  const weightInKg = Number(feresula) * KG_PER_FERESULA;
  const validWeight = Number.isFinite(Number(feresula)) && Number(feresula) > 0 && Number(feresula) <= 100000 / KG_PER_FERESULA;

  const capture = async () => {
    if (!perm?.granted) {
      const permission = await ask();
      if (!permission.granted) showAlert(t('enableCamera'), t('cameraPermission'));
      return;
    }
    try {
      const photo = await cam?.takePictureAsync({ base64: true, quality: 0.72, skipProcessing: false });
      if (photo?.base64 && photo.uri) setPreview({ base64: photo.base64, uri: photo.uri, mimeType: 'image/jpeg' });
      else showAlert(t('gradingFailed'), t('cameraHint'));
    } catch (error) {
      showAlert(t('gradingFailed'), error instanceof Error ? error.message : t('gradingFailed'));
    }
  };

  const gallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.72 });
    if (!result.canceled && result.assets[0]?.base64 && result.assets[0]?.uri) {
      setPreview({ base64: result.assets[0].base64, uri: result.assets[0].uri, mimeType: result.assets[0].mimeType || 'image/jpeg' });
    }
  };

  const submitPreview = async () => {
    if (!preview) return;
    if (!validWeight) {
      showAlert(t('invalidWeight'), t('invalidWeightHint'));
      return;
    }
    const captureId = 'bunalens-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const batchCode = lot?.batch_code ?? 'BNL-JMA-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    setBusy(true);
    try {
      if (!(await isOnline())) {
        await enqueueCapture({
          id: captureId, batch_code: batchCode, batch_id: lot?.id, image_uri: preview.uri, sample_type: type, woreda,
          lot_weight_kg: weightInKg, created_at: new Date().toISOString(),
          station_id: station.id, mime_type: preview.mimeType,
        });
        await refreshQueue();
        setPreview(null);
        showAlert(t('savedForLater'), t('offlineQueue'));
        return;
      }
      if (station.id === 'station-demo') {
        showAlert(t('registerStation'), t('registerStationHint'));
        return;
      }
      const hasPro = Boolean(station.pro_expires_at && new Date(station.pro_expires_at).getTime() > Date.now());
      if (!hasPro && station.credits < 1) {
        showAlert(t('credits'), t('noCreditsHint'));
        return;
      }
      let coordinates: { latitude: number; longitude: number } | undefined;
      // Alert callbacks never fire on React Native Web, which would leave this
      // promise pending and block submission, so browsers use a native confirm.
      const wantsLocation = Platform.OS === 'web'
        ? typeof window !== 'undefined' && window.confirm(t('locationConsentTitle') + '\n\n' + t('locationConsentBody'))
        : await new Promise<boolean>((resolve) => {
            Alert.alert(
              t('locationConsentTitle'),
              t('locationConsentBody'),
              [
                { text: t('notNow'), style: 'cancel', onPress: () => resolve(false) },
                { text: t('allowLocation'), onPress: () => resolve(true) },
              ],
              { cancelable: true, onDismiss: () => resolve(false) },
            );
          });
      if (wantsLocation) {
        try {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.granted) {
            const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          }
        } catch { /* GPS is optional; the operator can still assess the sample. */ }
      }
      const batch = await submitCoffeeSample(preview.base64, type, woreda, station.id, captureId, weightInKg, preview.mimeType, coordinates, batchCode, lot?.id);
      if (!hasPro) consumeCredit();
      const savedImage = await persistLocalImage(preview.uri, captureId, preview.mimeType).catch(() => preview.uri);
      const finalBatch: CoffeeBatch = { ...batch, image_uri: savedImage, origin_coordinates: coordinates, status: 'synced' };
      addBatch(finalBatch);
      void logUserActivity('coffee_batch_submitted', { batch_id: finalBatch.id, batch_code: finalBatch.batch_code, station_id: station.id });
      setPreview(null);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push({ pathname: '/batch/[id]', params: { id: finalBatch.id } });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('gradingFailed');
      const retryable = error instanceof TypeError || message.toLowerCase().includes('temporarily') || message.toLowerCase().includes('timed out') || message.toLowerCase().includes('could not reach');
      if (retryable) {
        try {
          await enqueueCapture({
            id: captureId, batch_code: batchCode, batch_id: lot?.id, image_uri: preview.uri, sample_type: type, woreda,
            lot_weight_kg: weightInKg, created_at: new Date().toISOString(),
            station_id: station.id, mime_type: preview.mimeType,
          });
          await refreshQueue();
          setPreview(null);
          showAlert(t('savedForRetry'), t('retryHint'));
        } catch { showAlert(t('gradingFailed'), message); }
      } else showAlert(t('gradingFailed'), message);
    } finally {
      setBusy(false);
    }
  };

  const demo = async (defective: boolean) => {
    if (!validWeight) {
      showAlert(t('invalidWeight'), t('invalidWeightHint'));
      return;
    }
    const id = 'demo-' + Date.now();
    try {
      if (lot) {
        // Saved on the registered lot through the server, which labels it as a demo fixture.
        await attachDemoAssessment(lot, defective, preview ? { base64: preview.base64, mimeType: preview.mimeType } : undefined);
        setPreview(null);
        setDemoOpen(false);
        router.push({ pathname: '/batch/[id]', params: { id: lot.id } });
        return;
      }
      // A captured photograph may be retained with the local demo record for
      // traceability. The preset assessment remains simulated and never claims
      // to have analysed the photograph.
      const savedImage = preview
        ? await persistLocalImage(preview.uri, id, preview.mimeType)
        : undefined;
      const result = getDemoAssessment(defective, type);
      const batch: CoffeeBatch = {
        id, batch_code: 'BNL-JMA-' + String(Date.now()).slice(-4),
        sample_type: type, woreda, created_at: new Date().toISOString(),
        ...(savedImage ? { image_uri: savedImage } : {}),
        result, lot_weight_kg: weightInKg, status: 'demo', station_id: station.id,
        pricing: priceAssessment(type, result.ecx_grade, weightInKg), verification_id: id,
      };
      addBatch(batch);
      setPreview(null);
      setDemoOpen(false);
      router.push({ pathname: '/batch/[id]', params: { id } });
    } catch (error) {
      showAlert(t('gradingFailed'), error instanceof Error ? error.message : t('gradingFailed'));
    }
  };

  return (
    <ScrollView className="flex-1 p-5" style={{ backgroundColor: theme.colors.parchment }} contentContainerStyle={{ paddingBottom: 34 }} showsVerticalScrollIndicator={false}>
      <View className="flex-row items-center justify-between mb-5">
        <View><Text className="text-2xl font-black" style={{ color: theme.colors.espresso }}>{t('scanTitle')}</Text><Text className="text-xs mt-1" style={{ color: theme.colors.secondary }}>{t('scanSubtitle')}</Text></View>
        <LanguageToggle />
      </View>

      <View className="flex-row items-start rounded-2xl p-4 mb-4" style={{ backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA' }}>
        <Info size={16} color={theme.colors.harvest} />
        <Text className="text-xs ml-2 flex-1 leading-5" style={{ color: '#7C2D12' }}>{t('fieldLighting')}</Text>
      </View>

      {lot ? (
        <View testID="scan-lot-banner" className="rounded-2xl p-4 mb-4" style={{ backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' }}>
          <Text className="text-xs font-extrabold" style={{ color: '#065F46' }}>Photographing a sample for lot {lot.batch_code}</Text>
          <Text className="text-[11px] mt-1" style={{ color: '#065F46' }}>Lot ID: {lot.id} · {lot.sample_type === 'red_cherry' ? 'Red cherries' : 'Green beans'} · {lot.woreda} · {lot.lot_weight_kg} kg. The assessment is saved on this lot. Stage, origin and weight come from the lot record.</Text>
        </View>
      ) : null}
      <Text className="text-sm font-extrabold mb-2" style={{ color: theme.colors.espresso }}>{t('selectSampleType')}</Text>
      <View className="flex-row gap-3 mb-5">
        {(['red_cherry', 'green_bean'] as const).map((sample) => (
          <Pressable key={sample} accessibilityRole="button" accessibilityState={{ selected: type === sample, disabled: Boolean(lot) }} disabled={Boolean(lot)} onPress={() => setType(sample)}
            className={`flex-1 p-4 rounded-3xl border-2 ${type === sample ? 'bg-cherry-soft border-cherry' : 'bg-white border-line'}`}>
            <View className="flex-row items-center justify-between"><Coffee color={type === sample ? theme.colors.cherry : theme.colors.secondary} size={21} />{type === sample ? <ShieldCheck color={theme.colors.cherry} size={17} /> : null}</View>
            <Text className="text-sm font-extrabold mt-3" style={{ color: theme.colors.espresso }}>{sample === 'red_cherry' ? t('redCherries') : t('greenBeans')}</Text>
            <Text className="text-[10px] mt-1" style={{ color: theme.colors.secondary }}>{sample === 'red_cherry' ? t('red') : t('green')}</Text>
          </Pressable>
        ))}
      </View>

      <Text className="text-sm font-extrabold text-espresso mb-2">{t('coffeeOrigin')}</Text>
      <View className="flex-row items-center mb-2"><MapPin size={14} color={theme.colors.secondary} /><Text className="text-xs font-semibold ml-1" style={{ color: theme.colors.secondary }}>{t('jimmaZone')} · {t('woreda')}</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-5">
        {JIMMA_WOREDAS.map((item) => <Pressable key={item} onPress={() => setWoreda(item)} className={`px-4 py-2.5 mr-2 rounded-full border ${item === woreda ? 'bg-espresso border-espresso' : 'bg-white border-line'}`}><Text className={`text-xs font-bold ${item === woreda ? 'text-white' : 'text-espresso'}`}>{item}</Text></Pressable>)}
      </ScrollView>

      <View className="mb-5">
        <View className="flex-row items-center mb-2"><Scale size={14} color={theme.colors.secondary} /><Text className="text-sm font-extrabold ml-1.5" style={{ color: theme.colors.espresso }}>{t('lotSizeFeresula')}</Text></View>
        <TextInput keyboardType="decimal-pad" value={feresula} onChangeText={setFeresula} className="border rounded-xl px-4 py-3.5 font-bold" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line, color: theme.colors.espresso }} placeholder="10" placeholderTextColor={theme.colors.muted} />
        <Text className="text-[10px] mt-1.5" style={{ color: theme.colors.secondary }}>{t('feresulaConversion')}: {validWeight ? weightInKg.toLocaleString() : '—'} kg · 1 Feresula = 17 kg</Text>
      </View>

      <Text className="text-sm font-extrabold text-espresso mb-2">{t('captureSample')}</Text>
      {preview ? (
        <View className="rounded-3xl overflow-hidden border-2 border-emerald p-3" style={{ backgroundColor: theme.colors.surface }}>
          <Image source={{ uri: preview.uri }} resizeMode="contain" style={{ width: '100%', height: 260, borderRadius: 14, backgroundColor: '#292524' }} />
          <Text className="text-emerald font-bold text-xs text-center mt-3">{t('photoReady')}</Text>
          <View className="flex-row gap-2 mt-3">
            <Pressable onPress={() => setPreview(null)} disabled={busy} className="flex-1 bg-stone-100 p-3 rounded-xl flex-row items-center justify-center"><RotateCcw size={16} color={theme.colors.espresso} /><Text className="text-espresso font-bold ml-2">{t('retake')}</Text></Pressable>
            <Pressable onPress={submitPreview} disabled={busy} className="flex-1 p-3 rounded-xl flex-row items-center justify-center" style={{ backgroundColor: theme.colors.cherry, opacity: busy ? 0.65 : 1 }}>{busy ? <ActivityIndicator color="white" /> : <><ScanLine size={16} color="white" /><Text className="text-white font-bold ml-2">{t('submitForAssessment')}</Text></>}</Pressable>
          </View>
        </View>
      ) : perm?.granted ? (
        <>
          <View className="rounded-3xl overflow-hidden border-2 border-white" style={{ height: 320, backgroundColor: '#1C1917' }}>
            <CameraView ref={setCam} facing="back" flash={flash ? 'on' : 'off'} style={{ flex: 1 }} />
            <View pointerEvents="none" className="absolute inset-5 border-2 border-white/70 rounded-2xl" />
            <View pointerEvents="none" className="absolute left-1/2 top-5 bottom-5" style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.35)' }} />
            <View className="absolute top-3 right-3"><Pressable onPress={() => setFlash((v) => !v)} className="rounded-full p-3" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}><Zap size={18} color={flash ? '#FBBF24' : 'white'} /></Pressable></View>
            <View className="absolute bottom-3 left-3 right-3 rounded-xl px-3 py-2" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}><Text className="text-white text-[11px] font-semibold text-center">{t('cameraHint')}</Text></View>
          </View>
          <Pressable accessibilityRole="button" disabled={busy} onPress={capture} className="p-4 rounded-2xl mt-4 items-center flex-row justify-center" style={{ backgroundColor: theme.colors.cherry }}><Camera color="white" size={19} /><Text className="text-white font-black ml-2">{t('takePhoto')}</Text></Pressable>
        </>
      ) : (
        <Pressable onPress={ask} className="h-56 rounded-3xl items-center justify-center" style={{ backgroundColor: theme.colors.espresso }}><Camera color="white" size={36} /><Text className="text-white font-extrabold mt-3">{t('enableCamera')}</Text><Text className="text-white/70 text-xs mt-1">{t('cameraPermission')}</Text></Pressable>
      )}
      {!preview ? <Pressable accessibilityRole="button" onPress={gallery} className="p-4 rounded-2xl mt-2 border items-center flex-row justify-center" style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.line }}><ImagePlus color={theme.colors.espresso} size={18} /><Text className="text-espresso font-bold ml-2">{t('chooseGallery')}</Text></Pressable> : null}

      <Pressable onPress={() => setDemoOpen(true)} className="mt-7 rounded-2xl border p-4 flex-row items-center justify-between" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}><View className="flex-1"><Text className="text-sm font-extrabold" style={{ color: '#92400E' }}>{t('demoTitle')} · {t('demoOnly')}</Text><Text className="text-[11px] mt-1" style={{ color: '#92400E' }}>{t('demoHint')}</Text></View><ChevronRight size={18} color="#92400E" /></Pressable>
      {busy ? <View className="rounded-2xl p-4 mt-4 flex-row items-center" style={{ backgroundColor: theme.colors.espresso }}><ActivityIndicator color="#FFFFFF" /><View className="ml-3 flex-1"><Text className="text-white font-bold text-sm">{t('assessmentProgress')}</Text><Text className="text-[10px] text-stone-300 mt-1">{t('pleaseWait')}</Text></View></View> : null}
      <Modal visible={demoOpen} transparent animationType="slide" onRequestClose={() => setDemoOpen(false)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}><View className="rounded-t-3xl p-6" style={{ backgroundColor: theme.colors.parchment }}>
          <View className="flex-row items-center justify-between mb-2"><Text className="text-lg font-black text-espresso">{t('demoTitle')}</Text><Pressable onPress={() => setDemoOpen(false)}><Text className="text-sm font-bold text-cherry">{t('cancel')}</Text></Pressable></View>
          <Text className="text-[11px] text-secondary mb-4">{preview
            ? (language === 'om'
              ? 'Suuraan kaaftan galmee kana waliin kuufama; garuu qabxiin fi qoodinsi mudaa fakkeenya qophaa’e dha. Suuraan AI’n hin xiinxalamu.'
              : 'Your captured photo will be saved with this record for reference. The score and defect breakdown are preset demonstration data; the photo is not analysed.')
            : t('demoHint')}</Text>
          <Pressable onPress={() => demo(false)} className="bg-emerald p-4 rounded-xl mb-2"><Text className="text-white font-bold">{t('cleanDemo')}</Text></Pressable>
          <Pressable onPress={() => demo(true)} className="bg-harvest p-4 rounded-xl"><Text className="text-white font-bold">{t('defectDemo')}</Text></Pressable>
          <Text className="text-[9px] font-bold text-center mt-4" style={{ color: '#92400E' }}>{t('demoOnly')}</Text>
        </View></View>
      </Modal>
      <View className="flex-row items-start mt-5"><ShieldCheck size={13} color={theme.colors.secondary} /><Text className="text-[10px] ml-2 flex-1 leading-4" style={{ color: theme.colors.secondary }}>{t('disclaimer')} AI-assisted visual assessment — not an official ECX laboratory certificate.</Text></View>
    </ScrollView>
  );
}
