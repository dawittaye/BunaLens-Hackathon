import React, { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import type { LotScreening } from '@/supabase/functions/_shared/screening';
import { fetchLotPhotoUrl } from '@/services/lots';

const LEVEL_COLOR = { low: '#57534E', moderate: '#B45309', high: '#B91C1C' } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', color: '#57534E', marginBottom: 4 }}>{title}</Text>
      {children}
    </View>
  );
}

const Line = ({ children, color = '#1C1917' }: { children: React.ReactNode; color?: string }) => (
  <Text style={{ fontSize: 12, lineHeight: 18, color }}>• {children}</Text>
);

/** Saved photo screening for one lot. Shown separately from warehouse sensor readings. */
export default function LotScreeningCard({ screening, imagePath }: { screening: LotScreening; imagePath?: string | null }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setPhotoUrl(null);
    if (imagePath) void fetchLotPhotoUrl(imagePath).then((url) => { if (active) setPhotoUrl(url); });
    return () => { active = false; };
  }, [imagePath]);

  const demo = screening.source === 'demo_fixture';
  const stage = screening.sample_stage === 'red_cherry' ? 'Red cherries' : 'Green beans';
  return (
    <View testID="lot-screening" style={{ backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E7E5E4', padding: 16, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 15, fontWeight: '900', color: '#1C1917' }}>Photo screening</Text>
        <Text testID="lot-screening-source" style={{ fontSize: 10, fontWeight: '800', color: demo ? '#92400E' : '#166534', backgroundColor: demo ? '#FEF3C7' : '#DCFCE7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
          {demo ? 'DEMO FIXTURE' : 'LIVE INFERENCE'}
        </Text>
      </View>
      {demo ? (
        <Text style={{ marginTop: 8, fontSize: 11, fontWeight: '700', color: '#92400E', backgroundColor: '#FFFBEB', borderRadius: 8, padding: 8 }}>
          DEMO FIXTURE — preset values. The photo was not analysed by a model.
        </Text>
      ) : null}
      <Text style={{ fontSize: 12, color: '#44403C', marginTop: 8 }}>Coffee stage: {stage}</Text>
      <Text style={{ fontSize: 12, color: '#44403C' }}>Assessed: {new Date(screening.assessed_at).toLocaleString()}</Text>
      <Text style={{ fontSize: 12, color: '#44403C' }}>Model: {screening.provider} · {screening.model}</Text>
      <Text style={{ fontSize: 12, color: '#44403C' }}>Official grade: {screening.official_grade}</Text>
      <Text testID="lot-screening-photo" style={{ fontSize: 12, color: '#44403C' }}>
        Photo: {imagePath ? 'stored privately for this station' : 'no photo stored with this assessment'}
      </Text>
      {photoUrl ? <Image source={{ uri: photoUrl }} resizeMode="cover" style={{ width: '100%', height: 150, borderRadius: 12, marginTop: 8, backgroundColor: '#292524' }} /> : null}

      {screening.needs_review ? (
        <View testID="lot-screening-review" style={{ marginTop: 12, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#991B1B' }}>Needs review</Text>
          {screening.review_reasons.map((reason) => <Line key={reason} color="#991B1B">{reason}</Line>)}
        </View>
      ) : null}
      {screening.photo.retake_guidance ? (
        <Text testID="lot-screening-retake" style={{ marginTop: 8, fontSize: 12, lineHeight: 18, color: '#92400E' }}>{screening.photo.retake_guidance}</Text>
      ) : null}

      <Section title="What is visible">
        {screening.observations.map((item) => <Line key={item}>{item}</Line>)}
      </Section>
      <Section title="Suspected defects (visual estimate, not a count)">
        {screening.suspected_defects.length === 0
          ? <Line>None above 3% of the visible sample.</Line>
          : screening.suspected_defects.map((item) => (
            <Line key={item.key} color={LEVEL_COLOR[item.level]}>{item.label}: about {item.visible_share_pct}% of the visible sample ({item.level})</Line>
          ))}
      </Section>
      <Section title="Next action">
        <Text testID="lot-screening-action" style={{ fontSize: 13, lineHeight: 19, fontWeight: '700', color: '#1C1917' }}>{screening.next_action}</Text>
      </Section>
      <Section title="Not assessed by a photo">
        {screening.not_assessed.map((item) => <Line key={item} color="#57534E">{item}</Line>)}
      </Section>
      <Section title="Limitations">
        {screening.limitations.map((item) => <Line key={item} color="#57534E">{item}</Line>)}
      </Section>
    </View>
  );
}
