import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { FileText, Download, RefreshCw, Users, CreditCard, MapPin, Sprout, Thermometer, BarChart3, AlertCircle } from 'lucide-react-native';
import { supabase } from '@/services/supabaseClient';
import { exportAdminReportPdf } from '@/services/adminReportPdf';

type Kind = 'general' | 'users' | 'payments' | 'directory' | 'coffee_plants' | 'climate';
type Period = 'daily' | 'weekly' | 'monthly' | 'annual' | 'custom';
type Row = Record<string, unknown>;
type Report = { id: string; title: string; period: string; generated: string; rows: Row[]; metrics: { label: string; value: string }[]; notes: string[]; count: number };
const GREEN = '#55765D', INK = '#26372D', MUTED = '#727C70', BORDER = '#E5E9E0';
const panel = { backgroundColor: '#FFFFFF', borderColor: BORDER, borderWidth: 1, borderRadius: 16 } as const;
const kinds: { key: Kind; label: string; icon: React.ComponentType<any> }[] = [
 { key: 'general', label: 'System overview', icon: BarChart3 }, { key: 'users', label: 'Users', icon: Users },
 { key: 'payments', label: 'Payments', icon: CreditCard }, { key: 'directory', label: 'Directory', icon: MapPin },
 { key: 'coffee_plants', label: 'Coffee plants', icon: Sprout }, { key: 'climate', label: 'Climate', icon: Thermometer }
];
const rel = (v: any) => Array.isArray(v) ? v[0] : v;
const fmtDate = (v: string) => new Date(v).toLocaleString();
const fmtETB = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ETB';
const escape = (v: unknown) => String(v ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

async function fetchAll<T>(query: (from: number, to: number) => any): Promise<T[]> {
 const out: T[] = [];
 for (let from = 0; from < 100000; from += 500) {
  const { data, error } = await query(from, from + 499);
  if (error) throw error;
  const page = (data || []) as T[];
  out.push(...page);
  if (page.length < 500) return out;
 }
 throw new Error('Report exceeds 100,000 rows. Narrow the date range.');
}
function getRange(period: Period, start: string, end: string) {
 const a = new Date(), b = new Date();
 if (period === 'daily') a.setHours(0,0,0,0);
 if (period === 'weekly') { a.setDate(a.getDate() - 6); a.setHours(0,0,0,0); }
 if (period === 'monthly') { a.setDate(1); a.setHours(0,0,0,0); }
 if (period === 'annual') { a.setMonth(0,1); a.setHours(0,0,0,0); }
 if (period === 'custom') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('Use YYYY-MM-DD for custom dates.');
  a.setTime(new Date(start + 'T00:00:00').getTime()); b.setTime(new Date(end + 'T23:59:59.999').getTime());
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || a > b) throw new Error('Invalid custom date range.');
 } else b.setHours(23,59,59,999);
 return { from: a.toISOString(), to: b.toISOString(), label: a.toLocaleDateString() + ' – ' + b.toLocaleDateString() };
}

export default function ReportingAnalytics() {
 const [kind,setKind] = useState<Kind>('general'), [period,setPeriod] = useState<Period>('monthly');
 const [start,setStart] = useState(''), [end,setEnd] = useState(''), [location,setLocation] = useState('');
 const [roleFilter,setRoleFilter] = useState(''), [statusFilter,setStatusFilter] = useState('');
 const [report,setReport] = useState<Report|null>(null), [history,setHistory] = useState<any[]>([]);
 const [admin,setAdmin] = useState('BunaLens administrator'), [loading,setLoading] = useState(false), [exporting,setExporting] = useState(false);
 const [error,setError] = useState(''), [notice,setNotice] = useState(''), [warning,setWarning] = useState('');
 const loadHistory = useCallback(async () => {
  if (!supabase) return;
  const { data, error: e } = await supabase.from('admin_report_history').select('id,report_reference,report_type,period_start,period_end,record_count,created_by_label,generation_status,created_at').order('created_at',{ascending:false}).limit(15);
  if (e) { setWarning('Apply the admin reporting migration to enable report history.'); return; }
  setWarning(''); setHistory(data || []);
 },[]);
 useEffect(() => {
  void loadHistory();
  void supabase?.auth.getUser().then(({data}) => setAdmin(data.user?.user_metadata?.full_name || data.user?.email || 'BunaLens administrator'));
 },[loadHistory]);

 const generate = async () => {
  const client = supabase;
  if (!client) { setError('Supabase is not configured.'); return; }
  setLoading(true); setError(''); setNotice(''); setReport(null);
  try {
   const d = getRange(period,start,end), from=d.from, to=d.to, notes:string[]=[];
   let rows:Row[]=[]; let metrics:{label:string;value:string}[]=[]; let recordCount=0;
   const users = async () => {
    const first = await client.functions.invoke('admin-users',{body:{action:'list',page:1,perPage:100}});
    if (first.error) throw first.error; if (first.data?.error) throw new Error(first.data.error);
    const out = [...(first.data.users || [])];
    for (let p=2;p<=(first.data.totalPages||1);p++) { const n=await client.functions.invoke('admin-users',{body:{action:'list',page:p,perPage:100}}); if(n.error)throw n.error; if(n.data?.error)throw new Error(n.data.error); out.push(...(n.data.users||[])); }
    return out.filter((u:any)=>u.created_at>=from && u.created_at<=to);
   };
   const payments = async () => {
    const [stationPayments, orderPayments] = await Promise.all([
     fetchAll<any>((a,b)=>client.from('station_payments').select('id,package_id,amount_etb,currency,chapa_tx_ref,status,created_at,verified_at,stations(name,woreda)').gte('created_at',from).lte('created_at',to).order('created_at',{ascending:false}).range(a,b)),
     fetchAll<any>((a,b)=>client.from('coffee_order_payments').select('id,order_id,chapa_tx_ref,amount_etb,currency,status,is_test,created_at,verified_at,coffee_orders(buyer_name,stations(name,woreda))').gte('created_at',from).lte('created_at',to).order('created_at',{ascending:false}).range(a,b))
    ]);
    return [
     ...stationPayments.map((p:any)=>({...p,payment_source:'Station subscription',payer:rel(p.stations)?.name||'—',station_name:rel(p.stations)?.name||'—',woreda:rel(p.stations)?.woreda||'—',is_test:false})),
     ...orderPayments.map((p:any)=>({...p,payment_source:p.is_test?'Marketplace order (test)':'Marketplace order',payer:rel(p.coffee_orders)?.buyer_name||'—',station_name:rel(rel(p.coffee_orders)?.stations)?.name||'—',woreda:rel(rel(p.coffee_orders)?.stations)?.woreda||'—'}))
    ];
   };
   const stations = () => fetchAll<any>((a,b)=>client.from('stations').select('id,name,station_name,woreda,zone,created_at').gte('created_at',from).lte('created_at',to).range(a,b));
   const batches = () => fetchAll<any>((a,b)=>client.from('coffee_batches').select('id,batch_code,sample_type,woreda,grading_status,ecx_grade,quality_score,lot_weight_kg,created_at,is_demo').eq('is_demo',false).gte('created_at',from).lte('created_at',to).range(a,b));
   const climate = () => fetchAll<any>((a,b)=>client.from('device_readings').select('id,recorded_at,temperature_c,humidity_pct,source,warehouse_zones(name),stations(name,woreda)').gte('recorded_at',from).lte('recorded_at',to).range(a,b));
   const directory = async () => {
    const [w,d,s] = await Promise.all([
     fetchAll<any>((a,b)=>client.from('woredas').select('id,name,zone,is_active').range(a,b)),
     fetchAll<any>((a,b)=>client.from('station_directory').select('id,name,woreda_id,is_active,created_at').range(a,b)),
     fetchAll<any>((a,b)=>client.from('stations').select('id,name,station_name,woreda,zone,created_at').range(a,b))
    ]); return {w,d,s};
   };

   if (kind==='users') {
    const data=(await users()).filter((u:any)=>(!location || [u.station?.woreda,u.station?.name].some((v:string)=>v?.toLowerCase().includes(location.toLowerCase())))&&(!roleFilter||String(u.role||'').toLowerCase().includes(roleFilter.toLowerCase()))&&(!statusFilter||String(u.status||'').toLowerCase().includes(statusFilter.toLowerCase())));
    rows=data.map((u:any)=>({name:u.full_name||'—',email:u.email||'—',role:u.role,status:u.status,station:u.station?.name||'—',woreda:u.station?.woreda||'—',registered:fmtDate(u.created_at)}));
    metrics=[{label:'Registrations',value:String(data.length)},{label:'Verified',value:String(data.filter((u:any)=>u.status==='verified').length)},{label:'Suspended',value:String(data.filter((u:any)=>u.status==='suspended').length)}]; recordCount=rows.length;
   } else if (kind==='payments') {
    const data=(await payments()).filter((p:any)=>(!location || [p.station_name,p.woreda,p.payer].some((v:string)=>v?.toLowerCase().includes(location.toLowerCase())))&&(!statusFilter||String(p.status||'').toLowerCase().includes(statusFilter.toLowerCase())));
    const verified=data.filter((p:any)=>p.status==='verified' && !p.is_test), total=verified.reduce((s:number,p:any)=>s+Number(p.amount_etb||0),0);
    rows=data.map((p:any)=>({source:p.payment_source,reference:p.chapa_tx_ref,payer:p.payer,station:p.station_name,woreda:p.woreda,package:p.package_id||'Marketplace order',amount:Number(p.amount_etb).toLocaleString()+' '+p.currency,status:p.status,test_mode:p.is_test?'yes':'no',created:fmtDate(p.created_at),verified:p.verified_at?fmtDate(p.verified_at):'—'}));
    metrics=[{label:'All transactions',value:String(data.length)},{label:'Verified non-test collections',value:fmtETB(total)},{label:'Pending',value:String(data.filter((p:any)=>p.status==='pending').length)},{label:'Failed / expired',value:String(data.filter((p:any)=>['failed','expired'].includes(p.status)).length)}];
    notes.push('Includes station subscription payments and marketplace order payments. Verified test-mode marketplace payments are listed but excluded from collected revenue. Pending, failed and expired transactions are excluded from revenue.');
   } else if (kind==='directory') {
    const x=await directory(), w=x.w.filter((v:any)=>!location||[v.name,v.zone].some((z:string)=>z?.toLowerCase().includes(location.toLowerCase()))), ids=new Set(w.map((v:any)=>v.id)), ds=x.d.filter((v:any)=>ids.has(v.woreda_id));
    rows=[...w.map((v:any)=>({type:'Woreda',name:v.name,zone:v.zone,status:v.is_active?'active':'inactive'})),...ds.map((v:any)=>({type:'Directory station',name:v.name,woreda:w.find((z:any)=>z.id===v.woreda_id)?.name||'—',status:v.is_active?'active':'inactive'})),...x.s.filter((v:any)=>!location||[v.woreda,v.zone,v.name,v.station_name].some((z:string)=>z?.toLowerCase().includes(location.toLowerCase()))).map((v:any)=>({type:'Registered station',name:v.station_name||v.name,woreda:v.woreda,zone:v.zone,status:'registered',registered:fmtDate(v.created_at)}))];
    if(statusFilter) rows=rows.filter(r=>String(r.status||'').toLowerCase().includes(statusFilter.toLowerCase()));
    metrics=[{label:'Woredas',value:String(w.length)},{label:'Directory stations',value:String(ds.length)},{label:'Registered stations',value:String(x.s.length)}]; recordCount=rows.length;
   } else if (kind==='coffee_plants') {
    const res=await fetch('https://api.gbif.org/v1/occurrence/search?scientificName=Coffea%20arabica&decimalLatitude=7.2,8.15&decimalLongitude=36.05,37.45&hasCoordinate=true&occurrenceStatus=PRESENT&establishmentMeans=NATIVE&limit=300');
    if(!res.ok)throw new Error('GBIF occurrence service returned '+res.status);
    const payload=await res.json(), plants=(payload.results||[]).filter((p:any)=>{const dt=p.eventDate||(p.year?String(p.year)+'-01-01':'');return p.establishmentMeans?.toUpperCase()==='NATIVE'&&(!dt||(dt>=from.slice(0,10)&&dt<=to.slice(0,10)))&&(!location||[p.locality,p.stateProvince,p.municipality].some((v:string)=>v?.toLowerCase().includes(location.toLowerCase())));});
    rows=plants.map((p:any)=>({scientific_name:p.scientificName||'Coffea arabica',locality:p.locality||p.municipality||'—',region:p.stateProvince||'—',latitude:p.decimalLatitude,longitude:p.decimalLongitude,date:p.eventDate||p.year||'—',record_basis:p.basisOfRecord||'—'}));
    metrics=[{label:'Occurrence records',value:String(rows.length)}]; recordCount=rows.length;
    notes.push('GBIF biodiversity occurrence data for the Jimma area. These are not BunaLens plant-health inspections or farm-level monitoring records.');
   } else if (kind==='climate') {
    const data=(await climate()).filter((x:any)=>(!location||[rel(x.stations)?.name,rel(x.stations)?.woreda,rel(x.warehouse_zones)?.name].some((v:string)=>v?.toLowerCase().includes(location.toLowerCase())))&&(!statusFilter||String(x.source||'').toLowerCase().includes(statusFilter.toLowerCase())));
    rows=data.map((x:any)=>({recorded:fmtDate(x.recorded_at),station:rel(x.stations)?.name||'—',woreda:rel(x.stations)?.woreda||'—',zone:rel(x.warehouse_zones)?.name||'—',temperature_c:x.temperature_c,humidity_pct:x.humidity_pct,source:x.source}));
    const live=data.filter((x:any)=>x.source==='live'), simulated=data.filter((x:any)=>x.source==='simulated');
    const liveAvg=live.length?live.reduce((s:number,x:any)=>s+Number(x.temperature_c),0)/live.length:0;
    metrics=[{label:'All sensor readings',value:String(data.length)},{label:'Live readings',value:String(live.length)},{label:'Simulated readings',value:String(simulated.length)},{label:'Live average temperature',value:live.length?liveAvg.toFixed(1)+' °C':'No live data'}];
    notes.push('Warehouse-zone air temperature and relative humidity readings; not outdoor weather forecasts or bean-moisture measurements. Simulated readings are identified separately and are not treated as live sensor data.'); recordCount=rows.length;
   } else {
    const [u0,p0,s0,b0,c0,d]=await Promise.all([users(),payments(),stations(),batches(),climate(),directory()]);
    const u=u0.filter((x:any)=>!location||[x.station?.woreda,x.station?.name].some((v:string)=>v?.toLowerCase().includes(location.toLowerCase())));
    const p=p0.filter((x:any)=>!location||[x.station_name,x.woreda,x.payer].some((v:string)=>v?.toLowerCase().includes(location.toLowerCase())));
    const s=s0.filter((x:any)=>!location||[x.woreda,x.zone,x.name,x.station_name].some((v:string)=>v?.toLowerCase().includes(location.toLowerCase())));
    const b=b0.filter((x:any)=>!location||x.woreda?.toLowerCase().includes(location.toLowerCase()));
    const c=c0.filter((x:any)=>!location||[rel(x.stations)?.name,rel(x.stations)?.woreda,rel(x.warehouse_zones)?.name].some((v:string)=>v?.toLowerCase().includes(location.toLowerCase())));
    const w=d.w.filter((x:any)=>!location||[x.name,x.zone].some((v:string)=>v?.toLowerCase().includes(location.toLowerCase())));
    const ids=new Set(w.map((x:any)=>x.id)), dirs=d.d.filter((x:any)=>ids.has(x.woreda_id));
    const verified=p.filter((x:any)=>x.status==='verified' && !x.is_test), total=verified.reduce((sum:number,x:any)=>sum+Number(x.amount_etb||0),0);
    rows=[{metric:'New users',value:u.length},{metric:'Payment transactions',value:p.length},{metric:'Verified collections',value:fmtETB(total)},{metric:'New registered stations',value:s.length},{metric:'Non-demo coffee batches',value:b.length},{metric:'Climate sensor readings',value:c.length},{metric:'Directory woredas',value:w.length},{metric:'Directory stations',value:dirs.length}];
    metrics=[{label:'New users',value:String(u.length)},{label:'Verified ETB',value:fmtETB(total)},{label:'Coffee batches',value:String(b.length)},{label:'Climate readings',value:String(c.length)}];
    recordCount=u.length+p.length+s.length+b.length+c.length+w.length+dirs.length;
    notes.push('Overview combines registrations, both payment streams, stations, non-demo batches, device readings and directory totals. Only verified non-test payments count as collections.');
   }
   if(location.trim())notes.push('Location filter: '+location.trim()+'.');
   const id='BNL-RPT-'+new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
   const next:Report={id,title:(kinds.find(x=>x.key===kind)?.label||'System')+' Report',period:d.label,generated:new Date().toISOString(),rows,metrics,notes,count:recordCount}; setReport(next);
   const {data:auth}=await client.auth.getUser();
   const {error:historyError}=await client.from('admin_report_history').insert({report_reference:id,report_type:kind,period_start:from.slice(0,10),period_end:to.slice(0,10),record_count:recordCount,filters:{period,location:location.trim()||null,role:roleFilter.trim()||null,status:statusFilter.trim()||null},created_by:auth.user?.id,created_by_label:admin,generation_status:'completed'});
   if(historyError)setWarning('Report generated. Apply the admin reporting migration to save history.');else await loadHistory();
   setNotice('Report generated from live system records.');
  } catch(e) { setError(e instanceof Error?e.message:'Report generation failed. Check administrator data permissions.'); }
  finally { setLoading(false); }
 };
 const exportPdf=async()=>{if(!report)return;setExporting(true);try{const result=await exportAdminReportPdf(report,admin);setNotice(result==='print'?'Print preview opened. Choose Save as PDF in your browser.':'PDF export is ready to download or share.');}catch(e){setError(e instanceof Error?e.message:'PDF export failed.');}finally{setExporting(false);}};
 const periods:Period[]=['daily','weekly','monthly','annual','custom'];
 return <View style={{gap:14}}>
  <View style={{...panel,padding:16,backgroundColor:'#26372D',borderColor:'#26372D',flexDirection:'row',alignItems:'center',gap:10}}><FileText color="#FFFFFF" size={23}/><View style={{flex:1}}><Text style={{color:'#FFFFFF',fontSize:16,fontWeight:'900'}}>Reporting & Analytics</Text><Text style={{color:'#C3D0C1',fontSize:10}}>Live BunaLens operational reports</Text></View><Text style={{color:'#C3D0C1',fontSize:9}}>LIVE</Text></View>
  <Text style={{color:INK,fontSize:15,fontWeight:'900'}}>Report category</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{kinds.map(k=>{const I=k.icon,active=kind===k.key;return <Pressable key={k.key} onPress={()=>{setKind(k.key);setReport(null);}} style={{...panel,padding:11,minWidth:125,flexGrow:1,borderColor:active?GREEN:BORDER,backgroundColor:active?'#EFF5ED':'#FFFFFF'}}><I color={active?GREEN:MUTED} size={18}/><Text style={{color:active?GREEN:INK,fontSize:10,fontWeight:'900',marginTop:7}}>{k.label}</Text></Pressable>;})}</View>
  <View style={{...panel,padding:14,gap:10}}><Text style={{color:INK,fontSize:14,fontWeight:'900'}}>Report filters</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{periods.map(p=><Pressable key={p} onPress={()=>setPeriod(p)} style={{paddingHorizontal:11,paddingVertical:8,borderRadius:9,borderWidth:1,borderColor:period===p?GREEN:BORDER,backgroundColor:period===p?'#EFF5ED':'#FFFFFF'}}><Text style={{color:period===p?GREEN:MUTED,fontSize:10,fontWeight:'800'}}>{p[0]!.toUpperCase()+p.slice(1)}</Text></Pressable>)}</View>
  {period==='custom'?<View style={{flexDirection:'row',gap:8}}><TextInput value={start} onChangeText={setStart} placeholder="Start YYYY-MM-DD" style={{flex:1,borderWidth:1,borderColor:BORDER,borderRadius:9,padding:10,color:INK,fontSize:11}}/><TextInput value={end} onChangeText={setEnd} placeholder="End YYYY-MM-DD" style={{flex:1,borderWidth:1,borderColor:BORDER,borderRadius:9,padding:10,color:INK,fontSize:11}}/></View>:null}
  <TextInput value={location} onChangeText={setLocation} placeholder="Optional location: station, woreda or zone" style={{borderWidth:1,borderColor:BORDER,borderRadius:9,padding:11,color:INK,fontSize:11}}/>
  {kind==='users'?<TextInput value={roleFilter} onChangeText={setRoleFilter} placeholder="Optional user role: farmer, buyer, admin…" style={{borderWidth:1,borderColor:BORDER,borderRadius:9,padding:11,color:INK,fontSize:11}}/>:null}
  {['users','payments','directory','climate'].includes(kind)?<TextInput value={statusFilter} onChangeText={setStatusFilter} placeholder={kind==='climate'?'Optional source: live or simulated':'Optional status: verified, pending, active…'} style={{borderWidth:1,borderColor:BORDER,borderRadius:9,padding:11,color:INK,fontSize:11}}/>:null}
  <Pressable onPress={()=>void generate()} disabled={loading} style={{backgroundColor:'#26372D',borderRadius:11,padding:13,alignItems:'center',flexDirection:'row',justifyContent:'center',gap:8}}>{loading?<ActivityIndicator color="#FFFFFF"/>:<BarChart3 color="#FFFFFF" size={16}/>}<Text style={{color:'#FFFFFF',fontWeight:'900',fontSize:11}}>{loading?'Generating…':'Generate report'}</Text></Pressable></View>
  {error?<View style={{...panel,padding:12,borderColor:'#E7BDB3',flexDirection:'row',gap:7}}><AlertCircle color="#A34F3E"/><Text style={{color:'#7D3C32',fontSize:10,flex:1}}>{error}</Text></View>:null}
  {notice?<Text style={{color:GREEN,fontSize:10,fontWeight:'800'}}>{notice}</Text>:null}
  {report?<View style={{...panel,padding:14,gap:10}}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8}}><View style={{flex:1}}><Text style={{color:INK,fontSize:16,fontWeight:'900'}}>{report.title}</Text><Text style={{color:MUTED,fontSize:9}}>{report.period} · {report.count.toLocaleString()} records</Text></View><Pressable onPress={()=>void exportPdf()} disabled={exporting} style={{backgroundColor:GREEN,borderRadius:9,padding:10,flexDirection:'row',alignItems:'center',gap:5}}>{exporting?<ActivityIndicator color="#FFFFFF"/>:<Download color="#FFFFFF" size={14}/>}<Text style={{color:'#FFFFFF',fontSize:10,fontWeight:'900'}}>PDF</Text></Pressable></View>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:7}}>{report.metrics.map(m=><View key={m.label} style={{backgroundColor:'#F3F5EF',padding:10,borderRadius:9,minWidth:110,flexGrow:1}}><Text style={{color:MUTED,fontSize:8}}>{m.label}</Text><Text style={{color:INK,fontSize:13,fontWeight:'900',marginTop:4}}>{m.value}</Text></View>)}</View>
  {report.notes.map((n,i)=><Text key={i} style={{color:MUTED,fontSize:9}}>• {n}</Text>)}<Text style={{color:INK,fontWeight:'900',fontSize:12}}>Preview</Text>
  {report.rows.slice(0,8).map((row,i)=><View key={i} style={{borderTopWidth:1,borderColor:'#EEF0EC',paddingVertical:7}}><Text style={{color:INK,fontSize:10,fontWeight:'800'}}>{String(Object.values(row)[0]??'Record')}</Text><Text numberOfLines={2} style={{color:MUTED,fontSize:9}}>{Object.entries(row).slice(1,5).map(([k,v])=>k.replaceAll('_',' ')+': '+String(v??'—')).join(' · ')}</Text></View>)}
  <Text style={{color:MUTED,fontSize:8}}>Ref: {report.id} · Retrieved: {fmtDate(report.generated)}</Text></View>:null}
  <View style={{...panel,padding:14,gap:8}}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{color:INK,fontSize:14,fontWeight:'900'}}>Report history</Text><Pressable onPress={()=>void loadHistory()}><RefreshCw size={15} color={GREEN}/></Pressable></View>{warning?<Text style={{color:'#9A6A37',fontSize:9}}>{warning}</Text>:null}{history.length?history.map(h=><View key={h.id} style={{borderTopWidth:1,borderColor:'#EEF0EC',paddingVertical:8}}><Text style={{color:INK,fontSize:10,fontWeight:'800'}}>{h.report_type.replaceAll('_',' ')} · {h.record_count} records · {h.generation_status}</Text><Text style={{color:MUTED,fontSize:9}}>{h.report_reference} · {h.period_start} – {h.period_end} · by {h.created_by_label}</Text></View>):<Text style={{color:MUTED,fontSize:10}}>No reports generated yet.</Text>}</View>
 </View>;
}
