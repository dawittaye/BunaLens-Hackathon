import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { fetchListing, orderStateLabel, submitOrder, type CoffeeOrder, type Listing } from '@/services/marketplace';

const SOURCE: Record<string, string> = { measured: 'measured', visually_estimated: 'visual estimate from a photo', reviewer_entered: 'entered by a reviewer', simulated: 'SIMULATED', missing: 'missing' };
const newKey = () => 'order-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
const input = { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6D3D1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#1C1917', marginBottom: 8 } as const;

/** Buyer details page: what the listing rests on, then quantity and order. */
export default function ListingDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [quantity, setQuantity] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<CoffeeOrder | null>(null);
  // One key per order form, so a retry after a network failure cannot create a second order.
  const key = useRef(newKey());

  useEffect(() => {
    let active = true;
    void fetchListing(String(id)).then((found) => { if (active) setListing(found); }).catch(() => { if (active) setListing(null); });
    return () => { active = false; };
  }, [id]);

  if (listing === undefined) return <View style={{ flex: 1, padding: 20, backgroundColor: '#FAF7F2' }}><ActivityIndicator color="#7C2D12" /></View>;
  if (!listing) return <View style={{ flex: 1, padding: 20, backgroundColor: '#FAF7F2' }}><Text onPress={() => router.back()} style={{ color: '#7C2D12', fontWeight: '800' }}>‹ Back</Text><Text testID="listing-unavailable" style={{ marginTop: 12 }}>This listing is not available.</Text></View>;

  const kg = Number(quantity);
  const validKg = quantity !== '' && Number.isFinite(kg) && kg > 0 && kg <= listing.available_kg;
  const evidence = listing.evidence_summary;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await submitOrder(listing.id, kg, key.current, name, phone);
      setOrder(result.order);
      key.current = newKey();
    } catch (e) { setError(e instanceof Error ? e.message : 'The order could not be submitted.'); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#FAF7F2' }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text onPress={() => router.back()} style={{ color: '#7C2D12', fontWeight: '800', marginBottom: 10 }}>‹ Back</Text>
      <Text style={{ fontSize: 20, fontWeight: '900', color: '#1C1917' }}>{listing.coffee_stage === 'red_cherry' ? 'Red cherries' : 'Green beans'} · {listing.origin_woreda}</Text>
      <Text style={{ fontSize: 13, color: '#44403C', marginTop: 4 }}>{listing.seller_display_name}</Text>
      <Text testID="listing-lot" style={{ fontSize: 12, color: '#57534E', marginTop: 2 }}>Lot {listing.batch_code} · Lot ID {listing.batch_id}</Text>
      {listing.is_demo ? <Text style={{ marginTop: 8, fontSize: 11, fontWeight: '800', color: '#92400E', backgroundColor: '#FFFBEB', borderRadius: 8, padding: 8 }}>DEMO DATA — this listing rests on simulated evidence. It is not a real lot.</Text> : null}
      <View style={{ flexDirection: 'row', marginTop: 12, gap: 10 }}>
        <View style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#E7E5E4' }}><Text style={{ fontSize: 11, color: '#57534E' }}>Price</Text><Text testID="listing-price" style={{ fontSize: 17, fontWeight: '900', color: '#166534' }}>{listing.price_per_kg_etb.toLocaleString()} ETB/kg</Text></View>
        <View style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#E7E5E4' }}><Text style={{ fontSize: 11, color: '#57534E' }}>Available</Text><Text testID="listing-available" style={{ fontSize: 17, fontWeight: '900', color: '#1C1917' }}>{listing.available_kg.toLocaleString()} kg</Text></View>
      </View>

      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E7E5E4', padding: 14, marginTop: 12 }}>
        <Text style={{ fontSize: 14, fontWeight: '900', color: '#1C1917' }}>Evidence</Text>
        <Text style={{ fontSize: 12, lineHeight: 18, color: '#44403C', marginTop: 6 }}>{listing.screening_summary}</Text>
        <Text style={{ fontSize: 11, color: '#57534E', marginTop: 4 }}>Screening date: {listing.assessed_at ? new Date(listing.assessed_at).toLocaleString() : 'none'}</Text>
        {(evidence.inputs ?? []).map((item) => (
          <Text key={item.input} style={{ fontSize: 12, lineHeight: 18, color: '#1C1917', marginTop: 6 }}>
            {item.label}: {item.status === 'not_applicable' ? 'not applied to this coffee stage' : (item.value ?? '—') + ' ' + (item.unit ?? '')}
            {item.source ? '\nSource: ' + (SOURCE[item.source] ?? item.source) + (item.method ? ' · method ' + item.method : '') + (item.verification_status ? ' · ' + item.verification_status : '') : ''}
          </Text>
        ))}
        <Text testID="listing-approval" style={{ fontSize: 11, lineHeight: 16, color: '#57534E', marginTop: 10 }}>
          Eligible for listing under {evidence.policy_is_demo ? 'DEMO ' : ''}policy {evidence.policy_id}, decided by {evidence.decided_by === 'reviewer' ? 'a reviewer' : 'the listing rules'}{evidence.is_override ? ' (administrator override)' : ''}{evidence.decided_at ? ' on ' + new Date(evidence.decided_at).toLocaleDateString() : ''}. Seller approved by an administrator. Official grade: {evidence.official_grade ?? 'Unclassified'}. This is not a grade certificate or export approval.
        </Text>
      </View>

      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E7E5E4', padding: 14, marginTop: 12 }}>
        <Text style={{ fontSize: 14, fontWeight: '900', color: '#1C1917', marginBottom: 8 }}>Order from the seller</Text>
        {order ? (
          <View testID="order-confirmation">
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#166534' }}>{orderStateLabel(order)}</Text>
            <Text testID="order-total" style={{ fontSize: 13, color: '#1C1917', marginTop: 4 }}>{order.quantity_kg} kg × {order.price_per_kg_etb} ETB = {order.total_etb.toLocaleString()} ETB (calculated by the server)</Text>
            <Text style={{ fontSize: 11, color: '#57534E', marginTop: 4 }}>No money has changed hands. The seller now accepts or rejects the order.</Text>
            <Pressable onPress={() => router.push('/market/orders')} style={{ marginTop: 10 }}><Text style={{ color: '#7C2D12', fontWeight: '800' }}>See my orders ›</Text></Pressable>
          </View>
        ) : (
          <>
            <TextInput testID="order-quantity" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="Kilograms" placeholderTextColor="#A8A29E" style={input} />
            <TextInput testID="order-name" value={name} onChangeText={setName} placeholder="Buyer name" placeholderTextColor="#A8A29E" style={input} />
            <TextInput testID="order-phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Phone (optional)" placeholderTextColor="#A8A29E" style={input} />
            <Text testID="order-estimate" style={{ fontSize: 12, color: '#44403C', marginBottom: 8 }}>
              {validKg ? 'Estimated total: ' + (Math.round(kg * listing.price_per_kg_etb * 100) / 100).toLocaleString() + ' ETB. The server calculates the final total.' : 'Enter between 0 and ' + listing.available_kg.toLocaleString() + ' kg.'}
            </Text>
            <Pressable testID="order-submit" accessibilityRole="button" disabled={busy || !validKg || name.trim().length < 2} onPress={submit}
              style={{ backgroundColor: '#7C2D12', borderRadius: 12, padding: 13, alignItems: 'center', opacity: busy || !validKg || name.trim().length < 2 ? 0.5 : 1 }}>
              <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{busy ? 'Submitting…' : 'Submit order'}</Text>
            </Pressable>
            {error ? <Text testID="order-error" style={{ color: '#991B1B', fontSize: 12, marginTop: 8 }}>{error}</Text> : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}
