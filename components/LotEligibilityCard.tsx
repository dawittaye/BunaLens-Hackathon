import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { evaluateLotEligibility, fetchLotEligibility, type LotEligibility } from '@/services/lots';

const STATUS: Record<string, { label: string; color: string; background: string }> = {
  eligible: { label: 'ELIGIBLE FOR LISTING', color: '#166534', background: '#DCFCE7' },
  rejected: { label: 'NOT ELIGIBLE', color: '#991B1B', background: '#FEE2E2' },
  needs_review: { label: 'NEEDS MANUAL REVIEW', color: '#92400E', background: '#FEF3C7' },
  unreviewed: { label: 'NOT EVALUATED', color: '#44403C', background: '#E7E5E4' },
};
const CHECK_COLOR: Record<string, string> = { pass: '#166534', fail: '#991B1B', manual_review: '#92400E', not_applicable: '#78716C' };
const SOURCE: Record<string, string> = {
  measured: 'measured', visually_estimated: 'visual estimate', reviewer_entered: 'reviewer-entered', simulated: 'SIMULATED', missing: 'missing',
};

/** Listing eligibility for one lot. Separate from photo screening, publication and official grade. */
export default function LotEligibilityCard({ batchId }: { batchId: string }) {
  const [data, setData] = useState<LotEligibility | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await fetchLotEligibility(batchId)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Eligibility could not be loaded.'); }
  }, [batchId]);
  useEffect(() => { void load(); }, [load]);

  const evaluate = async () => {
    setBusy(true);
    try { await evaluateLotEligibility(batchId); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The lot could not be evaluated.'); }
    finally { setBusy(false); }
  };

  if (error && !data) return null; // not a station lot, or not signed in
  if (!data) return <ActivityIndicator style={{ marginBottom: 14 }} color="#7C2D12" />;
  const status = STATUS[data.eligibility_status] ?? STATUS.unreviewed!;
  const result = data.current_rule_result;
  const last = data.last_decision;
  return (
    <View testID="lot-eligibility" style={{ backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E7E5E4', padding: 16, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 15, fontWeight: '900', color: '#1C1917' }}>Listing eligibility</Text>
        <Text testID="lot-eligibility-status" style={{ fontSize: 10, fontWeight: '800', color: status.color, backgroundColor: status.background, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>{status.label}</Text>
      </View>
      <Text style={{ marginTop: 8, fontSize: 11, color: '#92400E', backgroundColor: '#FFFBEB', borderRadius: 8, padding: 8 }}>
        {result.policy.is_demo ? 'DEMO policy' : 'Policy'} {result.policy.id}. Sprint thresholds, not a grading standard or export certification. Official grade: {result.official_grade}.
      </Text>
      {last ? (
        <Text testID="lot-eligibility-decision" style={{ marginTop: 8, fontSize: 12, lineHeight: 18, color: '#1C1917' }}>
          Last decision: {last.decision.replace('_', ' ')} by {last.decided_by === 'reviewer' ? 'a reviewer' : 'the rules'}{last.is_override ? ' (administrator override of a failed rule)' : ''} on {new Date(last.decided_at).toLocaleString()}. {last.reason}
          {last.matches_current_evidence ? '' : ' Evidence has changed since this decision; evaluate again.'}
        </Text>
      ) : <Text style={{ marginTop: 8, fontSize: 12, color: '#44403C' }}>No decision is recorded for this lot yet.</Text>}
      {result.uses_simulated_evidence ? <Text style={{ marginTop: 6, fontSize: 11, fontWeight: '700', color: '#92400E' }}>Uses SIMULATED evidence. Any listing is marked as demo.</Text> : null}
      <View style={{ marginTop: 10 }}>
        {result.checks.map((check) => (
          <View key={check.input} style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: CHECK_COLOR[check.status] ?? '#1C1917' }}>{check.label}: {check.status.replace('_', ' ')}</Text>
            <Text style={{ fontSize: 11, lineHeight: 16, color: '#57534E' }}>
              {check.reason}{check.source ? ' Source: ' + (SOURCE[check.source] ?? check.source) + (check.method ? ', method ' + check.method : '') + (check.verification_status ? ', ' + check.verification_status : '') + '.' : ''}
            </Text>
          </View>
        ))}
      </View>
      <Pressable testID="lot-eligibility-evaluate" accessibilityRole="button" disabled={busy} onPress={evaluate}
        style={{ marginTop: 6, backgroundColor: '#1C1917', borderRadius: 12, padding: 12, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 12 }}>{busy ? 'Evaluating…' : 'Evaluate against the listing rules'}</Text>
      </Pressable>
      {error ? <Text style={{ marginTop: 6, fontSize: 11, color: '#991B1B' }}>{error}</Text> : null}
      <Text style={{ marginTop: 8, fontSize: 10, lineHeight: 15, color: '#78716C' }}>Eligible does not mean published. The seller publishes separately, and the rules are checked again at that moment. Warehouse humidity is not used as bean moisture.</Text>
    </View>
  );
}
