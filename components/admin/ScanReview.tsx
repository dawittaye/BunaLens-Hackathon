import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { RefreshCw, Coffee } from 'lucide-react-native';
import { supabase } from '@/services/supabaseClient';

type StationSummary = { name: string | null; station_name?: string | null; manager: string | null; marketplace_seller_status: string };
type ScanRow = {
  id: string; station_id: string; batch_code: string; sample_type: string; woreda: string; lot_weight_kg: number; image_path: string | null;
  grading_status: string; eligibility_status: string; is_demo: boolean; created_at: string;
  grading_result: any;
  certification_status?: string; certified_grade?: string | null; quality_classification?: string | null;
  marketplace_listings?: { status: string }[] | { status: string } | null;
  stations?: StationSummary[] | null;
};
const panel = { backgroundColor: '#FFFFFF', borderColor: '#E5E9E0', borderWidth: 1, borderRadius: 18 } as const;
const green = '#55765D', ink = '#26372D', muted = '#727C70';

export default function AdminScanReview() {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [classifications, setClassifications] = useState<Record<string, string>>({});
  const gradeOptions = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7'];
  const classificationOptions = ['Specialty Export','Commercial Export','Local Market Only','Reject / Re-sort'];
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [rescanMessages, setRescanMessages] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const client = supabase;
    if (!client) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const { data, error: queryError } = await client
        .from('coffee_batches')
        .select('id,station_id,batch_code,sample_type,woreda,lot_weight_kg,image_path,grading_status,eligibility_status,is_demo,created_at,grading_result,certification_status,certified_grade,quality_classification,marketplace_listings(status),stations(name,station_name,manager,marketplace_seller_status)')
        .order('created_at', { ascending: false }).limit(500);
      if (queryError) throw queryError;
      const scans = (data || []) as unknown as ScanRow[];
      const stationIds = [...new Set(scans.map((row) => row.station_id).filter(Boolean))];
      const statusByStation = new Map<string, string>();
      if (stationIds.length) {
        // Read seller status directly from stations instead of relying only on
        // an embedded PostgREST relationship that can remain stale after an RPC.
        const { data: stationStates, error: stationError } = await client
          .from('stations').select('id,marketplace_seller_status').in('id', stationIds);
        if (!stationError) for (const station of stationStates || []) {
          statusByStation.set(station.id, station.marketplace_seller_status || 'pending');
        }
      }
      const signedEntries = await Promise.all(scans.filter((row) => row.image_path).map(async (row) => {
        const { data, error } = await client.storage.from('coffee-samples').createSignedUrl(row.image_path as string, 60 * 30);
        return [row.id, error ? '' : (data?.signedUrl || '')] as const;
      }));
      setImageUrls(Object.fromEntries(signedEntries.filter(([, url]) => Boolean(url))));
      setRows(scans.map((row) => {
        const related = row.stations?.[0];
        const currentStatus = statusByStation.get(row.station_id) || related?.marketplace_seller_status || 'pending';
        return { ...row, stations: [{ ...(related || { name: null, manager: null }), marketplace_seller_status: currentStatus }] };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The scan review queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (row: ScanRow, decision: 'eligible' | 'rejected') => {
    if (!supabase) return;
    const fail = (message: string) => { setRowErrors((old) => ({ ...old, [row.id]: message })); setError(''); };
    const reason = (reasons[row.id] || '').trim();
    const sellerStatus = row.stations?.[0]?.marketplace_seller_status || 'pending';
    const screening = row.grading_result?.screening;
    if (decision === 'eligible' && screening?.source !== 'live_inference') { fail('Cannot certify yet: this record has no live AI screening evidence. The station must retake and submit a real coffee sample scan.'); return; }
    if (decision === 'eligible' && (screening?.photo?.usable !== true || screening?.needs_review === true)) { fail('Cannot certify this photo yet: ' + (screening?.photo?.retake_guidance || 'the photo-quality check requires a clearer sample photograph.')); return; }
    if (reason.length < 10) { fail('Add an administrator review note of at least 10 characters. You have entered ' + reason.length + '.'); return; }
    const priceText = (prices[row.id] || '').trim();
    const price = priceText ? Number(priceText) : null;
    if (decision === 'eligible' && priceText && (!Number.isFinite(price) || (price as number) <= 0)) {
      fail('The price must be a positive number in ETB/kg. Leave this field empty if you only want to certify and not publish.'); return;
    }
    if (decision === 'eligible' && !(grades[row.id] || row.certified_grade)) { fail('Select one coffee grade (Grade 1–7) before certifying.'); return; }
    if (decision === 'eligible' && !(classifications[row.id] || row.quality_classification)) { fail('Select a quality classification before certifying.'); return; }
    if (decision === 'eligible' && (classifications[row.id] || row.quality_classification) === 'Reject / Re-sort') { fail('Reject / Re-sort is not a certificate outcome. Use the Reject button for this sample.'); return; }
    setBusyId(row.id); setError(''); setRowErrors((old) => ({ ...old, [row.id]: '' })); setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc('bunalens_admin_certify_reviewed_scan', {
        p_batch_id: row.id, p_image_path: row.image_path ?? null, p_decision: decision, p_reason: reason,
        p_price_per_kg_etb: decision === 'eligible' && price !== null ? price : null,
        p_certified_grade: decision === 'eligible' ? (grades[row.id] || row.certified_grade) : null,
        p_quality_classification: decision === 'eligible' ? (classifications[row.id] || row.quality_classification) : null,
      });
      if (rpcError) throw rpcError;
      setNotice(decision === 'eligible'
        ? (data as any)?.listing
          ? row.batch_code + ' certified and published to the marketplace.'
          : row.batch_code + ' certified. Marketplace publication can happen later after seller approval and a price are provided.'
        : row.batch_code + ' rejected. The station owner has been notified.');
      await load();
    } catch (e) {
      fail(e instanceof Error ? e.message : (e as { message?: string } | null)?.message || 'The review action failed. Refresh the queue and try again.');
    } finally {
      setBusyId('');
    }
  };

  const requestRescan = async (row: ScanRow) => {
    if (!supabase) return;
    setBusyId(row.id);
    setRowErrors((old) => ({ ...old, [row.id]: '' }));
    setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc('bunalens_admin_request_rescan', {
        p_batch_id: row.id,
        p_image_path: row.image_path ?? null,
        p_reason: (rescanMessages[row.id] || '').trim() || 'A fresh live AI screening assessment is required before certification.',
      });
      if (rpcError) throw rpcError;
      setNotice((data as any)?.already_notified
        ? 'A rescan request was already sent for ' + row.batch_code + ' within the last 24 hours.'
        : 'Rescan request sent to the station owner for ' + row.batch_code + '.');
      await load();
    } catch (e) {
      setRowErrors((old) => ({ ...old, [row.id]: e instanceof Error ? e.message : (e as { message?: string } | null)?.message || 'The rescan request could not be sent.' }));
    } finally { setBusyId(''); }
  };

  const confirmRescan = (row: ScanRow) => {
    if (row.certification_status !== 'certified') { void requestRescan(row); return; }
    const message = 'This will invalidate the current certificate and pause any public listing until the new scan is reviewed.';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(message)) void requestRescan(row);
    } else {
      Alert.alert('Request a rescan?', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Request rescan', onPress: () => { void requestRescan(row); } },
      ]);
    }
  };

  const approveSeller = async (row: ScanRow) => {
    if (!supabase) return;
    if (!row.station_id) { setError('Station identifier is unavailable for this scan.'); return; }
    setBusyId(row.id); setError(''); setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc('bunalens_set_seller_status', {
        p_station_id: row.station_id, p_status: 'approved',
        p_note: 'Marketplace seller approved by administrator after station review.',
      });
      if (rpcError) throw rpcError;
      // Update immediately so the publish control does not remain disabled
      // while the queue refreshes its joined station data.
      setRows((current) => current.map((item) => item.station_id !== row.station_id ? item : ({
        ...item,
        stations: [{ ...(item.stations?.[0] || { name: null, manager: null }), marketplace_seller_status: 'approved' }],
      })));
      setNotice('Seller approved. Review the scan evidence before publishing.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seller approval failed. Refresh the queue and try again.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ ...panel, padding: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}><Text style={{ color: ink, fontSize: 17, fontWeight: '900' }}>Scan review queue</Text><Text style={{ color: muted, fontSize: 11, marginTop: 4 }}>Every cloud-saved coffee scan appears here. Administrators assign the final grade and quality classification. Certification is separate from optional marketplace publication.</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh scan review queue" onPress={() => void load()} style={{ padding: 10 }}><RefreshCw size={17} color={green} /></Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: '#A34F3E', fontSize: 12 }}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: green, fontSize: 12, fontWeight: '800' }}>{notice}</Text> : null}
      {loading ? <View style={{ padding: 36, alignItems: 'center' }}><ActivityIndicator color={green} /><Text style={{ color: muted, marginTop: 9 }}>Loading submitted scans…</Text></View> : rows.map((row) => {
        const station = row.stations?.[0];
        const sellerStatus = station?.marketplace_seller_status || 'pending';
        const screening = row.grading_result?.screening;
        const liveEvidence = screening?.source === 'live_inference';
        const photoUsable = screening?.photo?.usable === true && screening?.needs_review !== true;
        const listingRows = Array.isArray(row.marketplace_listings) ? row.marketplace_listings : row.marketplace_listings ? [row.marketplace_listings] : [];
        const certified = row.certification_status === 'certified';
        const pending = certified ? !listingRows.some(listing => listing.status === 'published') : row.certification_status !== 'rejected';
        const needsPhoto = !liveEvidence || !photoUsable;
        return (
          <View key={row.id} style={{ ...panel, padding: 16, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center' }}><Coffee size={18} color={green} /></View>
              <View style={{ flex: 1 }}><Text style={{ color: ink, fontSize: 13, fontWeight: '900' }}>{row.batch_code}</Text><Text style={{ color: muted, fontSize: 10, marginTop: 3 }}>{station?.station_name || station?.name || 'Registered station'} · {row.woreda} · {row.sample_type === 'green_bean' ? 'Green beans' : 'Red cherries'}</Text></View>
              <Text style={{ color: row.eligibility_status === 'eligible' ? green : row.eligibility_status === 'rejected' ? '#A34F3E' : '#9A6A37', fontSize: 10, fontWeight: '900' }}>{row.is_demo ? 'DEMO' : row.certification_status === 'certified' ? 'CERTIFIED' : row.eligibility_status.toUpperCase()}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              <Text style={{ color: muted, fontSize: 11 }}>{Number(row.lot_weight_kg).toLocaleString()} kg</Text>
              <Text style={{ color: muted, fontSize: 11 }}>{new Date(row.created_at).toLocaleString()}</Text>
              <Text style={{ color: muted, fontSize: 11 }}>Seller: {sellerStatus}</Text>
              <Text style={{ color: muted, fontSize: 11 }}>Evidence: {liveEvidence ? 'live AI screening' : screening?.source || 'no structured screening'}</Text>
              {liveEvidence ? <Text style={{ color: photoUsable ? green : '#9A6A37', fontSize: 11 }}>Photo: {photoUsable ? 'usable' : 'retake required'}</Text> : null}
            </View>
            {imageUrls[row.id] ? <Image source={{ uri: imageUrls[row.id] }} accessibilityLabel={'Stored sample photograph for ' + row.batch_code} resizeMode="contain" style={{ width: '100%', height: 190, borderRadius: 12, backgroundColor: '#F3F4F1' }} /> : <Text style={{ color: muted, fontSize: 10 }}>{row.image_path ? 'Stored photograph is not currently accessible. Refresh or check storage permissions.' : 'No photograph is attached to this scan.'}</Text>}
            {row.is_demo ? <Text style={{ color: '#A34F3E', fontSize: 11 }}>Demonstration record. It cannot be published as real coffee.</Text> : null}
            {!row.is_demo && sellerStatus !== 'approved' ? <Pressable disabled={busyId === row.id} onPress={() => void approveSeller(row)} style={{ backgroundColor: '#F6EFE3', borderRadius: 11, padding: 11, alignItems: 'center' }}><Text style={{ color: '#805B2D', fontSize: 11, fontWeight: '900' }}>{busyId === row.id ? 'Saving…' : 'Approve marketplace seller'}</Text></Pressable> : null}
            {!row.is_demo && pending && !needsPhoto ? <>
              <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>Administrator-certified coffee grade</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {gradeOptions.map((grade) => <Pressable key={grade} onPress={() => { setGrades((old) => ({ ...old, [row.id]: grade })); setRowErrors((old) => ({ ...old, [row.id]: '' })); }} style={{ borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: (grades[row.id] || row.certified_grade) === grade ? green : '#F1F4EF' }}><Text style={{ color: (grades[row.id] || row.certified_grade) === grade ? '#FFFFFF' : ink, fontSize: 10, fontWeight: '800' }}>{grade}</Text></Pressable>)}
              </View>
              <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>Quality classification</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {classificationOptions.map((item) => <Pressable key={item} onPress={() => { setClassifications((old) => ({ ...old, [row.id]: item })); setRowErrors((old) => ({ ...old, [row.id]: '' })); }} style={{ borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: (classifications[row.id] || row.quality_classification) === item ? green : '#F1F4EF' }}><Text style={{ color: (classifications[row.id] || row.quality_classification) === item ? '#FFFFFF' : ink, fontSize: 10, fontWeight: '800' }}>{item}</Text></Pressable>)}
              </View>
              <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>Public price (ETB / kg)</Text>
              <TextInput value={prices[row.id] || ''} onChangeText={(value) => { setPrices((old) => ({ ...old, [row.id]: value })); setRowErrors((old) => ({ ...old, [row.id]: '' })); }} keyboardType="decimal-pad" placeholder="Optional: enter price to publish marketplace listing" style={{ borderWidth: 1, borderColor: '#E5E9E0', borderRadius: 11, padding: 11, color: ink }} />
              <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>Administrator certification note</Text>
              <TextInput value={reasons[row.id] || ''} onChangeText={(value) => { setReasons((old) => ({ ...old, [row.id]: value })); setRowErrors((old) => ({ ...old, [row.id]: '' })); }} placeholder="Record the basis for your decision (minimum 10 characters)" multiline style={{ borderWidth: 1, borderColor: '#E5E9E0', borderRadius: 11, padding: 11, color: ink, minHeight: 64 }} />
              <Text style={{ color: muted, fontSize: 10 }}>{(reasons[row.id] || '').trim().length}/10 minimum characters for the administrator note</Text>
              {rowErrors[row.id] ? <View accessibilityRole="alert" style={{ backgroundColor: '#FFF1ED', borderColor: '#E7B7A9', borderWidth: 1, borderRadius: 10, padding: 11 }}><Text style={{ color: '#963F2D', fontSize: 11, lineHeight: 16, fontWeight: '700' }}>{rowErrors[row.id]}</Text></View> : null}
              <View style={{ flexDirection: 'row', gap: 9 }}>
                <Pressable testID={'publish-' + row.batch_code} accessibilityRole="button" disabled={busyId === row.id} onPress={() => void decide(row, 'eligible')} style={{ flex: 1, backgroundColor: busyId === row.id ? '#AAB3A8' : green, borderRadius: 11, padding: 12, alignItems: 'center' }}><Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900' }}>{busyId === row.id ? 'Processing…' : row.certification_status === 'certified' ? 'Publish certified lot' : 'Approve & certify'}</Text></Pressable>
                <Pressable testID={'reject-' + row.batch_code} accessibilityRole="button" disabled={busyId === row.id} onPress={() => void decide(row, 'rejected')} style={{ backgroundColor: '#F7EAE5', borderRadius: 11, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: '#A34F3E', fontSize: 11, fontWeight: '900' }}>Reject</Text></Pressable>
              </View>
            </> : null}
            {!row.is_demo && (certified || (pending && needsPhoto)) ? <>
              <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>{certified ? 'Request a rescan' : 'Rescan required'}</Text>
              <Text style={{ color: muted, fontSize: 11, lineHeight: 16 }}>
                {certified ? 'A rescan invalidates the current certificate and pauses the public listing.' : liveEvidence
                  ? (screening?.photo?.retake_guidance || 'The station must retake the sample photograph and submit a new scan.')
                  : 'This older record has no structured AI screening result. The station must capture and submit a new real coffee scan. The old record will remain in the review history.'}
              </Text>
              <TextInput value={rescanMessages[row.id] || ''} onChangeText={(value) => setRescanMessages((old) => ({ ...old, [row.id]: value }))} placeholder="Optional instruction for the station owner" multiline style={{ borderWidth: 1, borderColor: '#E5E9E0', borderRadius: 11, padding: 11, color: ink, minHeight: 54 }} />
              {rowErrors[row.id] ? <View accessibilityRole="alert" style={{ backgroundColor: '#FFF1ED', borderColor: '#E7B7A9', borderWidth: 1, borderRadius: 10, padding: 11 }}><Text style={{ color: '#963F2D', fontSize: 11, lineHeight: 16, fontWeight: '700' }}>{rowErrors[row.id]}</Text></View> : null}
              <Pressable testID={'request-rescan-' + row.batch_code} accessibilityRole="button" disabled={busyId === row.id} onPress={() => confirmRescan(row)} style={{ backgroundColor: busyId === row.id ? '#AAB3A8' : '#805B2D', borderRadius: 11, padding: 12, alignItems: 'center' }}>
                <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900' }}>{busyId === row.id ? 'Sending request…' : 'Request new scan from station'}</Text>
              </Pressable>
              {!certified ? <>
              <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>Administrator rejection note</Text>
              <TextInput value={reasons[row.id] || ''} onChangeText={(value) => { setReasons((old) => ({ ...old, [row.id]: value })); setRowErrors((old) => ({ ...old, [row.id]: '' })); }} placeholder="Required only if rejecting (minimum 10 characters)" multiline style={{ borderWidth: 1, borderColor: '#E5E9E0', borderRadius: 11, padding: 11, color: ink, minHeight: 54 }} />
              <Pressable testID={'reject-' + row.batch_code} accessibilityRole="button" disabled={busyId === row.id} onPress={() => void decide(row, 'rejected')} style={{ backgroundColor: '#F7EAE5', borderRadius: 11, padding: 12, alignItems: 'center' }}>
                <Text style={{ color: '#A34F3E', fontSize: 11, fontWeight: '900' }}>Reject sample</Text>
              </Pressable>
              </> : null}
            </> : null}
            {row.eligibility_status === 'eligible' ? <Text style={{ color: green, fontSize: 11, fontWeight: '800' }}>Approved. Check the public marketplace listing status below.</Text> : null}
          </View>
        );
      })}
      {!loading && !rows.length ? <Text style={{ color: muted, padding: 20, textAlign: 'center' }}>No scans have been submitted yet.</Text> : null}
    </View>
  );
}
