import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { JIMMA_WOREDAS } from '@/constants/jimmaData';
import { fetchListings, type Listing } from '@/services/marketplace';
import type { SampleType } from '@/types';

const STAGES: { value: SampleType; label: string }[] = [{ value: 'green_bean', label: 'Green beans' }, { value: 'red_cherry', label: 'Red cherries' }];
const stageLabel = (stage: SampleType) => (stage === 'red_cherry' ? 'Red cherries' : 'Green beans');

function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: selected ? '#1C1917' : '#D6D3D1', backgroundColor: selected ? '#1C1917' : '#FFFFFF' }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: selected ? '#FFFFFF' : '#1C1917' }}>{label}</Text>
    </Pressable>
  );
}

/** Buyer browse: published listings with origin, stage and price filters applied on the server. */
export default function Marketplace() {
  const [origin, setOrigin] = useState<string | undefined>();
  const [stage, setStage] = useState<SampleType | undefined>();
  const [maxPrice, setMaxPrice] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const max = Number(maxPrice);
    const min = Number(minPrice);
    try {
      setListings(await fetchListings({ origin, stage, maxPrice: maxPrice && Number.isFinite(max) ? max : undefined, minPrice: minPrice && Number.isFinite(min) ? min : undefined }));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Listings could not be loaded.'); }
  }, [origin, stage, maxPrice, minPrice]);
  useEffect(() => { void load(); }, [load]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#FAF7F2' }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '900', color: '#1C1917' }}>Coffee marketplace</Text>
        <Pressable testID="market-orders-link" onPress={() => router.push('/market/orders')}><Text style={{ color: '#7C2D12', fontWeight: '800' }}>Orders ›</Text></Pressable>
      </View>
      <Text style={{ fontSize: 12, color: '#57534E', marginTop: 4, marginBottom: 14 }}>Lots listed directly by Jimma zone stations. Order from the seller; no broker in between.</Text>

      <Text style={{ fontSize: 11, fontWeight: '800', color: '#57534E', marginBottom: 6 }}>ORIGIN</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="All" selected={!origin} onPress={() => setOrigin(undefined)} />
        {JIMMA_WOREDAS.map((item) => <Chip key={item} testID={'market-origin-' + item} label={item} selected={origin === item} onPress={() => setOrigin(item)} />)}
      </View>
      <Text style={{ fontSize: 11, fontWeight: '800', color: '#57534E', marginBottom: 6, marginTop: 4 }}>COFFEE STAGE</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="All" selected={!stage} onPress={() => setStage(undefined)} />
        {STAGES.map((item) => <Chip key={item.value} testID={'market-stage-' + item.value} label={item.label} selected={stage === item.value} onPress={() => setStage(item.value)} />)}
      </View>
      <Text style={{ fontSize: 11, fontWeight: '800', color: '#57534E', marginBottom: 6, marginTop: 4 }}>PRICE PER KG (ETB)</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        <TextInput testID="market-min-price" value={minPrice} onChangeText={setMinPrice} keyboardType="decimal-pad" placeholder="From" placeholderTextColor="#A8A29E" style={{ flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6D3D1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: '#1C1917' }} />
        <TextInput testID="market-max-price" value={maxPrice} onChangeText={setMaxPrice} keyboardType="decimal-pad" placeholder="Up to" placeholderTextColor="#A8A29E" style={{ flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6D3D1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: '#1C1917' }} />
      </View>

      {error ? <Text style={{ color: '#991B1B', fontSize: 12 }}>{error}</Text> : null}
      {!listings && !error ? <ActivityIndicator color="#7C2D12" /> : null}
      {listings && listings.length === 0 ? <Text testID="market-empty" style={{ color: '#57534E', fontSize: 13 }}>No published lot matches these filters.</Text> : null}
      {(listings ?? []).map((item) => (
        <Pressable key={item.id} testID={'market-listing-' + item.batch_code} onPress={() => router.push({ pathname: '/market/[id]', params: { id: item.id } })}
          style={{ backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E7E5E4', padding: 14, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 15, fontWeight: '900', color: '#1C1917' }}>{stageLabel(item.coffee_stage)} · {item.origin_woreda}</Text>
            <Text style={{ fontSize: 15, fontWeight: '900', color: '#166534' }}>{item.price_per_kg_etb.toLocaleString()} ETB/kg</Text>
          </View>
          <Text style={{ fontSize: 12, color: '#44403C', marginTop: 4 }}>{item.seller_display_name} · Lot {item.batch_code} · {item.available_kg.toLocaleString()} kg available</Text>
          {item.is_demo ? <Text style={{ fontSize: 10, fontWeight: '800', color: '#92400E', marginTop: 6 }}>DEMO DATA — simulated evidence, not a real lot</Text> : null}
          <Text numberOfLines={2} style={{ fontSize: 11, color: '#57534E', marginTop: 6, lineHeight: 16 }}>{item.screening_summary}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
