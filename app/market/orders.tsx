import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { acceptOrder, cancelOrder, fetchOrders, fulfillOrder, orderStateLabel, rejectOrder, type CoffeeOrder } from '@/services/marketplace';

function Action({ label, onPress, tone = '#1C1917', testID }: { label: string; onPress: () => void; tone?: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={{ backgroundColor: tone, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginTop: 8 }}>
      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

/** Orders the signed-in account placed, and orders for its own station's listings. */
export default function Orders() {
  const [orders, setOrders] = useState<{ placed: CoffeeOrder[]; incoming: CoffeeOrder[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setOrders(await fetchOrders()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Orders could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const run = (action: (id: string) => Promise<void>, id: string) => async () => {
    setError(null);
    try { await action(id); } catch (e) { setError(e instanceof Error ? e.message : 'The action failed.'); }
    await load();
  };

  const card = (order: CoffeeOrder, seller: boolean) => (
    <View key={order.id} testID={(seller ? 'incoming-' : 'placed-') + order.id} style={{ backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E7E5E4', padding: 14, marginBottom: 12 }}>
      <Text style={{ fontSize: 14, fontWeight: '900', color: '#1C1917' }}>{orderStateLabel(order)}</Text>
      <Text style={{ fontSize: 12, color: '#44403C', marginTop: 4 }}>
        Lot {order.listing_snapshot.batch_code ?? order.batch_id} · {order.listing_snapshot.coffee_stage === 'red_cherry' ? 'Red cherries' : 'Green beans'} · {order.listing_snapshot.origin_woreda}
      </Text>
      <Text style={{ fontSize: 12, color: '#44403C' }}>{order.quantity_kg} kg × {order.price_per_kg_etb} ETB = {order.total_etb.toLocaleString()} ETB</Text>
      <Text style={{ fontSize: 11, color: '#57534E', marginTop: 2 }}>
        {seller ? 'Buyer: ' + order.buyer_name + (order.buyer_phone ? ' · ' + order.buyer_phone : '') : 'Seller: ' + (order.listing_snapshot.seller_display_name ?? '')} · {new Date(order.created_at).toLocaleString()}
      </Text>
      {order.listing_snapshot.is_demo ? <Text style={{ fontSize: 10, fontWeight: '800', color: '#92400E', marginTop: 4 }}>DEMO listing</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {seller && order.status === 'submitted' ? <Action testID={'accept-' + order.id} label="Accept" tone="#166534" onPress={run(acceptOrder, order.id)} /> : null}
        {seller && order.status === 'submitted' ? <Action testID={'reject-' + order.id} label="Reject" tone="#991B1B" onPress={run(rejectOrder, order.id)} /> : null}
        {seller && order.status === 'accepted' ? <Action testID={'fulfill-' + order.id} label="Record handover" onPress={run(fulfillOrder, order.id)} /> : null}
        {(order.status === 'submitted' || order.status === 'accepted') && (order.payment_status === 'unpaid' || order.payment_status === 'failed')
          ? <Action testID={'cancel-' + order.id} label="Cancel order" tone="#78716C" onPress={run(cancelOrder, order.id)} /> : null}
      </View>
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#FAF7F2' }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text onPress={() => router.back()} style={{ color: '#7C2D12', fontWeight: '800', marginBottom: 10 }}>‹ Back</Text>
      <Text style={{ fontSize: 22, fontWeight: '900', color: '#1C1917' }}>Orders</Text>
      <Text style={{ fontSize: 11, color: '#57534E', marginTop: 4, marginBottom: 14 }}>Accepting an order reserves the kilograms. It is not a payment. Cancelling an accepted, unpaid order returns the kilograms to the listing.</Text>
      {error ? <Text testID="orders-error" style={{ color: '#991B1B', fontSize: 12, marginBottom: 10 }}>{error}</Text> : null}
      {!orders ? <ActivityIndicator color="#7C2D12" /> : (
        <>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#1C1917', marginBottom: 8 }}>Orders for my station ({orders.incoming.length})</Text>
          {orders.incoming.length === 0 ? <Text style={{ fontSize: 12, color: '#57534E', marginBottom: 12 }}>No incoming orders.</Text> : orders.incoming.map((order) => card(order, true))}
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#1C1917', marginBottom: 8, marginTop: 6 }}>Orders I placed ({orders.placed.length})</Text>
          {orders.placed.length === 0 ? <Text style={{ fontSize: 12, color: '#57534E' }}>You have not placed an order.</Text> : orders.placed.map((order) => card(order, false))}
        </>
      )}
    </ScrollView>
  );
}
