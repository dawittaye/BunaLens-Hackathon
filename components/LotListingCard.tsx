import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { fetchListingForLot, saveListing, type Listing } from '@/services/marketplace';

const STATUS: Record<Listing['status'], string> = { draft: 'DRAFT — not public', published: 'PUBLISHED', paused: 'PAUSED — not public', sold_out: 'SOLD OUT', withdrawn: 'WITHDRAWN' };
const field = { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6D3D1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: '#1C1917' } as const;

/** Seller form for the marketplace listing of one lot. Publishing is always an explicit action. */
export default function LotListingCard({ batchId, lotWeightKg }: { batchId: string; lotWeightKg: number }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [kg, setKg] = useState('');
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await fetchListingForLot(batchId);
      setListing(found);
      if (found) { setKg(String(found.available_kg)); setPrice(String(found.price_per_kg_etb)); }
    } catch { /* not a station account: the card stays as an empty form */ }
  }, [batchId]);
  useEffect(() => { void load(); }, [load]);

  const save = (status: 'draft' | 'published' | 'paused' | 'withdrawn') => async () => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveListing(batchId, Number(kg), Number(price), status);
      setListing(saved);
      setMessage(status === 'published' ? 'Published. Buyers can now see this lot.' : 'Saved as ' + status + '.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'The listing could not be saved.'); }
    finally { setBusy(false); }
  };
  const valid = Number(kg) > 0 && Number(price) > 0;
  const button = (label: string, status: 'draft' | 'published' | 'paused' | 'withdrawn', tone: string) => (
    <Pressable testID={'listing-' + status} accessibilityRole="button" disabled={busy || !valid} onPress={save(status)}
      style={{ backgroundColor: tone, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginRight: 8, marginTop: 8, opacity: busy || !valid ? 0.5 : 1 }}>
      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );

  return (
    <View testID="lot-listing" style={{ backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E7E5E4', padding: 16, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 15, fontWeight: '900', color: '#1C1917' }}>Marketplace listing</Text>
        <Text testID="lot-listing-status" style={{ fontSize: 10, fontWeight: '800', color: listing?.status === 'published' ? '#166534' : '#44403C' }}>{listing ? STATUS[listing.status] : 'NOT LISTED'}</Text>
      </View>
      <Text style={{ fontSize: 11, color: '#57534E', marginTop: 6, marginBottom: 8 }}>Seller name, origin, coffee stage, screening summary and evidence are taken from the lot record. Lot weight: {lotWeightKg} kg.</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput testID="listing-kg" value={kg} onChangeText={setKg} keyboardType="decimal-pad" placeholder="Available kg" placeholderTextColor="#A8A29E" style={field} />
        <TextInput testID="listing-price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="ETB per kg" placeholderTextColor="#A8A29E" style={field} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {button('Save draft', 'draft', '#44403C')}
        {button('Publish', 'published', '#166534')}
        {listing?.status === 'published' ? button('Pause', 'paused', '#92400E') : null}
        {listing ? button('Withdraw', 'withdrawn', '#991B1B') : null}
      </View>
      {message ? <Text testID="lot-listing-message" style={{ fontSize: 12, color: '#1C1917', marginTop: 8 }}>{message}</Text> : null}
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <Text testID="lot-listing-orders" onPress={() => router.push('/market/orders')} style={{ color: '#7C2D12', fontWeight: '800', fontSize: 12, marginRight: 16 }}>Incoming orders ›</Text>
        <Text onPress={() => router.push('/(tabs)/marketplace')} style={{ color: '#7C2D12', fontWeight: '800', fontSize: 12 }}>Marketplace ›</Text>
      </View>
      <Text style={{ fontSize: 10, lineHeight: 15, color: '#78716C', marginTop: 8 }}>Publishing works only for an eligible lot of an approved seller with stock. The server checks this again when you publish.</Text>
    </View>
  );
}
