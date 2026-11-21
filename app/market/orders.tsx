import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  acceptOrder, cancelOrder, fetchOrders, fetchVerifiedPayments, fulfillOrder, orderStateLabel, rejectOrder,
  startOrderPayment, verifyOrderPayment, type CoffeeOrder, type OrderPayment,
} from '@/services/marketplace';

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
  const [payments, setPayments] = useState<OrderPayment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrders(await fetchOrders());
      setPayments(await fetchVerifiedPayments());
    } catch (e) { setError(e instanceof Error ? e.message : 'Orders could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const run = (action: (id: string) => Promise<unknown>, id: string) => async () => {
    setError(null);
    setNotice(null);
    try { await action(id); } catch (e) { setError(e instanceof Error ? e.message : 'The action failed.'); }
    await load();
  };
  // Opens the Chapa TEST checkout. The order is marked paid only after the server verifies it with Chapa.
  const pay = async (id: string) => {
    const started = await startOrderPayment(id, 'pay-' + id.slice(0, 8) + '-' + Date.now());
    setNotice('Chapa TEST checkout opened for ' + started.amount_etb.toLocaleString() + ' ETB. After paying, press "Check payment". No real money is used.');
    await Linking.openURL(started.checkout_url);
  };
  const checkPayment = async (id: string) => {
    const result = await verifyOrderPayment(id);
    setNotice(result.result === 'verified' || result.result === 'already_verified'
      ? 'Chapa confirmed the TEST payment.'
      : 'Chapa has not confirmed a payment yet (' + result.result + '). Nothing was marked as paid.');
  };

  const verifiedFor = (order: CoffeeOrder) => payments.find((payment) => payment.order_id === order.id && !payment.late_success);
  const card = (order: CoffeeOrder, seller: boolean) => {
    const payment = verifiedFor(order);
    const payable = !seller && order.status === 'accepted' && (order.payment_status === 'unpaid' || order.payment_status === 'failed' || order.payment_status === 'pending');
    return (
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
        {payment ? (
          <Text testID={'payment-' + order.id} style={{ fontSize: 11, color: '#166534', marginTop: 4 }}>
            {payment.is_test ? 'TEST payment' : 'Payment'} verified with Chapa: {Number(payment.amount_etb).toLocaleString()} ETB, reference {payment.chapa_tx_ref}{payment.verified_at ? ', ' + new Date(payment.verified_at).toLocaleString() : ''}.{payment.is_test ? ' Test mode: no money moved.' : ''}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {seller && order.status === 'submitted' ? <Action testID={'accept-' + order.id} label="Accept" tone="#166534" onPress={run(acceptOrder, order.id)} /> : null}
          {seller && order.status === 'submitted' ? <Action testID={'reject-' + order.id} label="Reject" tone="#991B1B" onPress={run(rejectOrder, order.id)} /> : null}
          {seller && order.status === 'accepted' ? <Action testID={'fulfill-' + order.id} label="Record handover" onPress={run(fulfillOrder, order.id)} /> : null}
          {payable ? <Action testID={'pay-' + order.id} label={order.payment_status === 'pending' ? 'Open Chapa TEST checkout again' : 'Pay with Chapa (TEST)'} tone="#166534" onPress={run(pay, order.id)} /> : null}
          {order.payment_status === 'pending' ? <Action testID={'check-payment-' + order.id} label="Check payment" onPress={run(checkPayment, order.id)} /> : null}
          {(order.status === 'submitted' || order.status === 'accepted') && (order.payment_status === 'unpaid' || order.payment_status === 'failed')
            ? <Action testID={'cancel-' + order.id} label="Cancel order" tone="#78716C" onPress={run(cancelOrder, order.id)} /> : null}
        </View>
      </View>
    );
  };

  const incomingIds = new Set((orders?.incoming ?? []).map((order) => order.id));
  const revenue = payments.filter((payment) => incomingIds.has(payment.order_id) && !payment.late_success);
  const revenueTotal = revenue.reduce((sum, payment) => sum + Number(payment.amount_etb), 0);
  const allTest = revenue.every((payment) => payment.is_test);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#FAF7F2' }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text onPress={() => router.back()} style={{ color: '#7C2D12', fontWeight: '800', marginBottom: 10 }}>‹ Back</Text>
      <Text style={{ fontSize: 22, fontWeight: '900', color: '#1C1917' }}>Orders</Text>
      <Text style={{ fontSize: 11, color: '#57534E', marginTop: 4, marginBottom: 14 }}>Accepting an order reserves the kilograms. It is not a payment. An order shows as paid only after the server has verified the payment with Chapa. Cancelling an accepted, unpaid order returns the kilograms to the listing.</Text>
      {error ? <Text testID="orders-error" style={{ color: '#991B1B', fontSize: 12, marginBottom: 10 }}>{error}</Text> : null}
      {notice ? <Text testID="orders-notice" style={{ color: '#1C1917', fontSize: 12, marginBottom: 10 }}>{notice}</Text> : null}
      {!orders ? <ActivityIndicator color="#7C2D12" /> : (
        <>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#1C1917', marginBottom: 8 }}>Orders for my station ({orders.incoming.length})</Text>
          {orders.incoming.length > 0 ? (
            <Text testID="orders-revenue" style={{ fontSize: 12, color: '#44403C', marginBottom: 10 }}>
              Payments verified with Chapa: {revenue.length}, {revenueTotal.toLocaleString()} ETB{revenue.length > 0 && allTest ? ' — all TEST payments. No money was received, settled or paid out.' : '. This is a record of verified checkouts, not a payout or wallet balance.'}
            </Text>
          ) : null}
          {orders.incoming.length === 0 ? <Text style={{ fontSize: 12, color: '#57534E', marginBottom: 12 }}>No incoming orders.</Text> : orders.incoming.map((order) => card(order, true))}
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#1C1917', marginBottom: 8, marginTop: 6 }}>Orders I placed ({orders.placed.length})</Text>
          {orders.placed.length === 0 ? <Text style={{ fontSize: 12, color: '#57534E' }}>You have not placed an order.</Text> : orders.placed.map((order) => card(order, false))}
        </>
      )}
    </ScrollView>
  );
}
