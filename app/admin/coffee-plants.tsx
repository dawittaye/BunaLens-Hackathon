import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg';
import { router } from 'expo-router';
import { ArrowLeft, Coffee, CreditCard, Database, Building2, ClipboardCheck, LayoutDashboard, LogOut, RefreshCw, Sprout, Thermometer, Wind, Droplets, Activity, Users } from 'lucide-react-native';
import { supabase } from '@/services/supabaseClient';
import CoffeeOriginMap from '@/components/CoffeeOriginMap';

type Site = { id: string; name: string; short: string; lat: number; lon: number };
type Point = { decimalLatitude: number; decimalLongitude: number; scientificName?: string; establishmentMeans?: string; basisOfRecord?: string; key?: number };
type PlantData = { forecast?: any; archive?: any; nasa?: any; soil?: any; gbif?: Point[]; errors: string[]; fetchedAt?: string };
const SITES: [Site, ...Site[]] = [
  { id: 'jarc', name: 'JARC Research Plots (Melko)', short: 'JARC Melko', lat: 7.6667, lon: 36.7833 },
  { id: 'gomma', name: 'Gomma Forest Coffee', short: 'Gomma (Agaro)', lat: 7.85, lon: 36.65 },
  { id: 'mana', name: 'Mana Highland Coffee', short: 'Mana (Yebu)', lat: 7.75, lon: 36.75 },
  { id: 'gera', name: 'Gera Wild Forest Coffee', short: 'Gera', lat: 7.7333, lon: 36.25 },
  { id: 'limu', name: 'Limu Kossa Plantation', short: 'Limu Kossa', lat: 7.95, lon: 36.95 },
];
const INK = '#26372D', MUTED = '#727C70', GREEN = '#55765D', BORDER = '#E5E9E0', BG = '#F3F5EF';
const panel = { backgroundColor: '#FFFFFF', borderColor: BORDER, borderWidth: 1, borderRadius: 18 } as const;
const fmt = (v: unknown, digits = 1) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const ymd = (d: Date) => isoDate(d).replaceAll('-', '');
const lastValid = (series: Record<string, number> | undefined) => {
  if (!series) return null;
  const entries = Object.entries(series).filter(([, v]) => typeof v === 'number' && v !== -999 && Number.isFinite(v)).sort(([a], [b]) => b.localeCompare(a));
  const latest = entries[0];
  return latest ? { date: latest[0], value: latest[1] } : null;
};
const soilValue = (soil: any, property: string, depth: string) => {
  const depths = soil?.properties?.[property]?.depths || [];
  const found = depths.find((d: any) => d.label === depth || d.range?.lower_depth === (depth === '0-5cm' ? 0 : 15));
  return found?.values?.mean ?? null;
};
function Metric({ title, value, unit, status, detail, icon: Icon }: any) {
  return <View style={{ ...panel, padding: 16, flexGrow: 1, flexBasis: 220, minWidth: 155 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: MUTED, fontSize: 11, fontWeight: '800' }}>{title}</Text><Icon size={17} color={GREEN} /></View>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 13 }}><Text style={{ color: INK, fontSize: 27, fontWeight: '900' }}>{value}</Text><Text style={{ color: MUTED, fontSize: 11, marginLeft: 5 }}>{unit}</Text></View>
    <Text style={{ color: GREEN, fontSize: 9, fontWeight: '900', marginTop: 8 }}>{status}</Text>
    <Text style={{ color: MUTED, fontSize: 10, marginTop: 4, lineHeight: 15 }}>{detail}</Text>
  </View>;
}
function Status({ children, tone = GREEN }: any) {
  return <View style={{ backgroundColor: tone + '18', borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 }}><Text style={{ color: tone, fontSize: 9, fontWeight: '900' }}>{children}</Text></View>;
}
export default function CoffeePlantMonitor() {
  const { width } = useWindowDimensions();
  const [siteId, setSiteId] = useState('jarc');
  const [data, setData] = useState<PlantData>({ errors: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [zoom, setZoom] = useState(true);
  const site = SITES.find(s => s.id === siteId) ?? SITES[0]!;
  const load = useCallback(async (quiet = false) => {
    if (!supabase) return;
    if (quiet) setRefreshing(true); else setLoading(true);
    const now = new Date();
    const ago30 = new Date(now); ago30.setDate(now.getDate()-30);
    const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
    const ago14 = new Date(now); ago14.setDate(now.getDate()-14);
    const forecastUrl = 'https://api.open-meteo.com/v1/forecast?latitude='+site.lat+'&longitude='+site.lon+'&current=soil_temperature_0cm,soil_temperature_6cm,soil_moisture_9_to_27cm,vapour_pressure_deficit,shortwave_radiation&hourly=soil_temperature_0cm,soil_temperature_6cm,soil_moisture_9_to_27cm,vapour_pressure_deficit,shortwave_radiation&daily=et0_fao_evapotranspiration,precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=Africa%2FAddis_Ababa&forecast_days=7';
    const archiveUrl = 'https://archive-api.open-meteo.com/v1/archive?latitude='+site.lat+'&longitude='+site.lon+'&start_date='+isoDate(ago30)+'&end_date='+isoDate(yesterday)+'&daily=precipitation_sum,temperature_2m_max,et0_fao_evapotranspiration&timezone=Africa%2FAddis_Ababa';
    const nasaUrl = 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=GWETROOT,ALLSKY_SFC_PAR_TOT&community=AG&longitude='+site.lon+'&latitude='+site.lat+'&start='+ymd(ago14)+'&end='+ymd(yesterday)+'&format=JSON';
    const soilUrl = 'https://rest.isric.org/soilgrids/v2.0/properties/query?lon='+site.lon+'&lat='+site.lat+'&property=phh2o&property=soc&property=clay&depth=0-5cm&depth=15-30cm&value=mean';
    const gbifUrl = 'https://api.gbif.org/v1/occurrence/search?scientificName=Coffea%20arabica&decimalLatitude=7.2,8.15&decimalLongitude=36.05,37.45&hasCoordinate=true&occurrenceStatus=PRESENT&establishmentMeans=NATIVE&limit=300';
    const tasks: Promise<any>[] = [
      fetch(forecastUrl).then(r=>{if(!r.ok)throw new Error('Open-Meteo forecast '+r.status);return r.json();}),
      fetch(archiveUrl).then(r=>{if(!r.ok)throw new Error('Open-Meteo archive '+r.status);return r.json();}),
      fetch(nasaUrl).then(r=>{if(!r.ok)throw new Error('NASA POWER '+r.status);return r.json();}),
      fetch(soilUrl).then(r=>{if(!r.ok)throw new Error('SoilGrids '+r.status);return r.json();}),
      fetch(gbifUrl).then(r=>{if(!r.ok)throw new Error('GBIF '+r.status);return r.json();}),
    ];
    const keys = ['forecast','archive','nasa','soil','gbif'] as const;
    tasks.forEach((task,index)=>{void task.then(result=>{
      const value = index===4 ? (result?.results||[]).filter((p:Point)=>Number.isFinite(p.decimalLatitude)&&Number.isFinite(p.decimalLongitude)&&p.establishmentMeans?.toUpperCase()==='NATIVE') : result;
      const key = keys[index];
      if (key) setData(old=>({...old,[key]:value}));
    }).catch(error=>setData(old=>({...old,errors:[...old.errors,String(error?.message||error)]})));});
    const settled = await Promise.allSettled(tasks);
    const errors:string[]=[];
    settled.forEach((result,index)=>{if(result.status==='rejected')errors.push(keys[index]!+': '+String(result.reason?.message||result.reason));});
    const values = settled.map(result=>result.status==='fulfilled'?result.value:undefined);
    const records=(values[4]?.results||[]).filter((p:Point)=>Number.isFinite(p.decimalLatitude)&&Number.isFinite(p.decimalLongitude)&&p.establishmentMeans?.toUpperCase()==='NATIVE');
    setData({forecast:values[0],archive:values[1],nasa:values[2],soil:values[3],gbif:records,errors,fetchedAt:new Date().toISOString()});
    setLoading(false);setRefreshing(false);
  },[site]);
  useEffect(()=>{void load();},[load]);
  const current=data.forecast?.current||{};
  const soilTemp=Number(current.soil_temperature_6cm??current.soil_temperature_0cm);
  const rootMoisture=Number(current.soil_moisture_9_to_27cm);
  const vpd=Number(current.vapour_pressure_deficit);
  const radiation=Number(current.shortwave_radiation);
  const gwet=lastValid(data.nasa?.properties?.parameter?.GWETROOT);
  const par=lastValid(data.nasa?.properties?.parameter?.ALLSKY_SFC_PAR_TOT);
  const phRaw=soilValue(data.soil,'phh2o','15-30cm');
  const socRaw=soilValue(data.soil,'soc','15-30cm');
  const clayRaw=soilValue(data.soil,'clay','0-5cm');
  const ph=typeof phRaw==='number'?phRaw/10:null;
  const soc=typeof socRaw==='number'?socRaw/10:null;
  const clay=typeof clayRaw==='number'?clayRaw/10:null;
  const rainfall=(data.archive?.daily?.precipitation_sum||[]).reduce((sum:number,v:number)=>sum+(Number(v)||0),0);
  const heatDays=(data.archive?.daily?.temperature_2m_max||[]).filter((v:number)=>Number(v)>28).length;
  const forecastDays=data.forecast?.daily?.time||[];
  const waterRows=forecastDays.slice(0,7).map((date:string,i:number)=>({date,soilTemp:data.forecast?.hourly?.soil_temperature_6cm?.[Math.min(i*24+12,(data.forecast?.hourly?.soil_temperature_6cm?.length||1)-1)],root:data.forecast?.hourly?.soil_moisture_9_to_27cm?.[Math.min(i*24+12,(data.forecast?.hourly?.soil_moisture_9_to_27cm?.length||1)-1)],et0:data.forecast?.daily?.et0_fao_evapotranspiration?.[i],rain:data.forecast?.daily?.precipitation_sum?.[i]}));
  const alert=Number.isFinite(rootMoisture)&&rootMoisture<0.18?'Root-zone moisture is low in this modelled grid cell. If cherries are filling, monitor drying and bean-size risk at the selected site.':heatDays>=8?'Repeated hot days in the 30-day archive may increase plant water demand. Check shade, mulch and soil moisture before interpreting lot-quality changes.':'No high-priority water or heat signal from the available model data. This is environmental context, not a coffee-lot defect diagnosis.';
  const tempStatus=Number.isFinite(soilTemp)?soilTemp>32?'HEAT STRESS':soilTemp<22?'COOL':'OPTIMAL GERMINATION RANGE':'NO DATA';
  const moistureStatus=Number.isFinite(rootMoisture)?rootMoisture<0.12?'WILTING RISK':rootMoisture<0.2?'MILD ROOT STRESS':'HYDRATED':'NO DATA';
  const vpdStatus=Number.isFinite(vpd)?vpd>1.6?'STOMATAL CLOSURE RISK':vpd>=0.4&&vpd<=1.2?'ACTIVE TRANSPIRATION':'VPD OUTSIDE TARGET':'NO DATA';
  const soilStatus=ph===null?'SOIL DATA UNAVAILABLE':ph>=5&&ph<=6.2?'WITHIN TARGET PH':'OUTSIDE TARGET PH';
  const timestamp=data.fetchedAt?new Date(data.fetchedAt).toLocaleTimeString(): 'Not yet updated';
  const narrow=width<850;
  const menu = [
    { label: 'Overview', icon: LayoutDashboard }, { label: 'Stations', icon: Building2 },
    { label: 'Payments', icon: CreditCard }, { label: 'Directory', icon: Database },
    { label: 'Users', icon: Users }, { label: 'Scan reviews', icon: ClipboardCheck },
  ];
  const signOut = async () => { await supabase?.auth.signOut(); router.replace('/admin-login'); };
  return <View style={{flex:1,flexDirection:narrow?'column':'row',backgroundColor:BG}}>
    <View style={{width:narrow?'100%':248,backgroundColor:INK,paddingHorizontal:15,paddingTop:narrow?12:26,paddingBottom:12}}>
      <View style={{flexDirection:'row',alignItems:'center',gap:10,marginBottom:narrow?10:30}}>
        <View style={{width:40,height:40,borderRadius:14,backgroundColor:GREEN,alignItems:'center',justifyContent:'center'}}><Coffee size={21} color="#FFFFFF"/></View>
        <View style={{flex:1}}><Text style={{color:'#FFFFFF',fontSize:17,fontWeight:'900'}}>BunaLens</Text><Text style={{color:'#C3D0C1',fontSize:9,fontWeight:'800',letterSpacing:1}}>ADMIN CONSOLE</Text></View>
        {narrow?<Pressable onPress={signOut} style={{padding:8}}><LogOut size={16} color="#FFFFFF"/></Pressable>:null}
      </View>
      {!narrow?<Text style={{color:'#9CAA9B',fontSize:9,fontWeight:'900',letterSpacing:1.2,marginHorizontal:10,marginBottom:9}}>WORKSPACE</Text>:null}
      <View style={{flexDirection:narrow?'row':'column',flexWrap:narrow?'wrap':'nowrap',gap:5}}>
        {menu.map(({label,icon:Icon})=><Pressable key={label} onPress={()=>router.replace('/admin')} style={{flexDirection:'row',alignItems:'center',gap:9,paddingHorizontal:10,paddingVertical:10,borderRadius:10,flexGrow:narrow?1:0,backgroundColor:'transparent'}}><Icon size={15} color="#AFB9AE"/><Text style={{color:'#AFB9AE',fontSize:11,fontWeight:'600'}}>{label}</Text></Pressable>)}
        <View style={{flexDirection:'row',alignItems:'center',gap:9,paddingHorizontal:10,paddingVertical:10,borderRadius:10,backgroundColor:'#3C5142',flexGrow:narrow?1:0}}><Sprout size={15} color="#FFFFFF"/><Text style={{color:'#FFFFFF',fontSize:11,fontWeight:'900'}}>Coffee Plant Monitor</Text></View>
      </View>
      {!narrow?<View style={{marginTop:'auto',paddingTop:20}}>
        <View style={{backgroundColor:'#35473A',borderRadius:14,padding:12,marginBottom:10}}><Text style={{color:'#DCE7D8',fontSize:10,fontWeight:'800'}}>Protected workspace</Text><Text style={{color:'#AEBBAD',fontSize:9,lineHeight:14,marginTop:5}}>Admin access is verified by your secure Supabase role.</Text></View>
        <Pressable onPress={signOut} style={{flexDirection:'row',alignItems:'center',padding:10,gap:9}}><LogOut size={15} color="#B7C0B5"/><Text style={{color:'#B7C0B5',fontSize:11,fontWeight:'700'}}>Sign out</Text></Pressable>
      </View>:null}
    </View>
    <ScrollView contentContainerStyle={{padding: narrow?14:28,paddingBottom:50,maxWidth:1600,width:'100%',alignSelf:'center'}}>
      <Pressable onPress={()=>router.replace('/admin')} style={{flexDirection:'row',alignItems:'center',gap:7,marginBottom:17}}><ArrowLeft size={16} color={GREEN}/><Text style={{color:GREEN,fontSize:11,fontWeight:'800'}}>Back to Admin Console</Text></Pressable>
      <View style={{flexDirection:narrow?'column':'row',justifyContent:'space-between',alignItems:narrow?'flex-start':'center',gap:12,marginBottom:19}}>
        <View style={{flex:1}}><Text style={{color:MUTED,fontSize:10,fontWeight:'800',letterSpacing:1}}>BUNALENS / ADMIN</Text><Text style={{color:INK,fontSize:narrow?24:30,fontWeight:'900',letterSpacing:-0.7,marginTop:5}}>Jimma Coffea arabica plant & seed monitor</Text><Text style={{color:MUTED,fontSize:12,lineHeight:18,marginTop:5}}>Live root-zone moisture, seedbed germination temperature, soil chemistry, and botanical forest telemetry across Jimma coffee woredas.</Text></View>
        <View style={{flexDirection:'row',alignItems:'center',gap:9}}><Status>● LIVE DATA</Status><Pressable onPress={()=>void load(true)} disabled={refreshing} style={{backgroundColor:INK,borderRadius:11,paddingHorizontal:13,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:7}}><RefreshCw size={14} color="#FFFFFF"/><Text style={{color:'#FFFFFF',fontSize:10,fontWeight:'800'}}>{refreshing?'Refreshing':'Refresh'}</Text></Pressable></View>
      </View>
      <View style={{...panel,padding:10,marginBottom:15}}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:7}}>{SITES.map(s=><Pressable key={s.id} onPress={()=>{setSiteId(s.id);setData({errors:[]});}} style={{backgroundColor:siteId===s.id?INK:'#F3F5EF',paddingHorizontal:13,paddingVertical:10,borderRadius:11}}><Text style={{color:siteId===s.id?'#FFFFFF':INK,fontSize:10,fontWeight:'800'}}>{s.name}</Text></Pressable>)}</ScrollView><Text style={{color:MUTED,fontSize:9,marginTop:8}}>Selected: {site.short} · {site.lat.toFixed(4)}°N, {site.lon.toFixed(4)}°E · refreshed {timestamp}</Text></View>
      {loading?<View style={{padding:32,alignItems:'center'}}><ActivityIndicator size="large" color={GREEN}/><Text style={{color:MUTED,marginTop:10,fontSize:11}}>Loading independent climate, soil and botanical sources…</Text></View>:null}
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:11}}>
        <Metric title="Seedbed Soil Temp (0–6 cm)" value={fmt(soilTemp)} unit="°C" status={tempStatus} detail="Open-Meteo gridded soil temperature at 6 cm" icon={Thermometer}/>
        <Metric title="Feeder-Root Moisture (9–27 cm)" value={fmt(rootMoisture,3)} unit="m³/m³" status={moistureStatus} detail={'Open-Meteo soil moisture · NASA root wetness '+(gwet?fmt(gwet.value,2)+' ('+gwet.date+')':'unavailable')} icon={Droplets}/>
        <Metric title="Leaf Stomatal Stress (VPD)" value={fmt(vpd,2)} unit="kPa" status={vpdStatus} detail={'Modelled vapour pressure deficit · radiation '+fmt(radiation,0)+' W/m²'} icon={Wind}/>
        <Metric title="Arabica Soil Suitability" value={ph===null?'—':fmt(ph,1)} unit="pH" status={soilStatus} detail={'15–30 cm SOC '+(soc===null?'—':fmt(soc,1)+' g/kg')+' · target pH 5.0–6.2'} icon={Sprout}/>
      </View>
      <View style={{...panel,padding:15,marginTop:15,borderLeftWidth:4,borderLeftColor:'#B7834D'}}><View style={{flexDirection:'row',alignItems:'center',gap:8}}><Activity size={17} color="#A36C34"/><Text style={{color:INK,fontSize:13,fontWeight:'900'}}>Phenological & bean-defect risk context</Text></View><Text style={{color:'#66533D',fontSize:11,lineHeight:18,marginTop:8}}>{alert}</Text><Text style={{color:MUTED,fontSize:9,marginTop:7}}>30-day rainfall: {fmt(rainfall,1)} mm · Days with Tmax above 28°C: {heatDays} · This is a screening alert, not a validated flowering/cherry-fill model and not a prediction of any batch's defects.</Text></View>
      <View style={{flexDirection:narrow?'column':'row',gap:13,marginTop:15,alignItems:'stretch'}}>
        <CoffeeOriginMap site={site} points={data.gbif||[]} zoom={zoom} onToggle={()=>setZoom(v=>!v)}/>
        <View style={{...panel,padding:15,flex:1.1,minWidth:280}}>
          <Text style={{color:INK,fontSize:15,fontWeight:'900'}}>7-day plant water balance</Text><Text style={{color:MUTED,fontSize:10,marginTop:4}}>Daily values from the selected Open-Meteo grid cell</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={{minWidth:490,marginTop:13}}>
            <View style={{flexDirection:'row',backgroundColor:'#F3F5EF',paddingVertical:9,borderRadius:8}}>{['Day','Root moisture','Soil 6 cm','ET0 mm','Rain mm','Rain − ET0'].map(h=><Text key={h} style={{width:h==='Day'?76:82,color:MUTED,fontSize:9,fontWeight:'900',paddingHorizontal:4}}>{h}</Text>)}</View>
            {waterRows.map((r:any)=><View key={r.date} style={{flexDirection:'row',paddingVertical:11,borderBottomWidth:1,borderColor:'#EEF0EC'}}><Text style={{width:76,color:INK,fontSize:10,fontWeight:'800'}}>{new Date(r.date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',day:'numeric'})}</Text><Text style={{width:82,color:INK,fontSize:10}}>{fmt(r.root,3)}</Text><Text style={{width:82,color:INK,fontSize:10}}>{fmt(r.soilTemp)}</Text><Text style={{width:82,color:INK,fontSize:10}}>{fmt(r.et0)}</Text><Text style={{width:82,color:INK,fontSize:10}}>{fmt(r.rain)}</Text><Text style={{width:82,color:(Number(r.rain)-Number(r.et0))<0?'#A34F3E':GREEN,fontSize:10,fontWeight:'800'}}>{fmt(Number(r.rain)-Number(r.et0))}</Text></View>)}
            {!waterRows.length?<Text style={{color:MUTED,padding:15,fontSize:10}}>Forecast values unavailable.</Text>:null}
          </View></ScrollView>
          <Text style={{color:MUTED,fontSize:9,lineHeight:14,marginTop:9}}>NASA PAR latest: {par?fmt(par.value,1)+' MJ/m²/day · '+par.date:'unavailable'} · Surface clay (0–5 cm): {clay===null?'—':fmt(clay,1)+'%'} · GBIF native occurrences: {(data.gbif||[]).length}</Text>
        </View>
      </View>
      <View style={{...panel,padding:14,marginTop:15}}>
        <Text style={{color:INK,fontSize:12,fontWeight:'900'}}>Data quality & source status</Text>
        <Text style={{color:MUTED,fontSize:10,lineHeight:16,marginTop:6}}>Open-Meteo and NASA POWER are gridded model/reanalysis products; SoilGrids is a modelled soil-property map, not a site soil test. GBIF points are occurrence records filtered to records marked NATIVE. No physical IoT sensor is implied.</Text>
        {data.errors.map((e,i)=><Text key={i} style={{color:'#A34F3E',fontSize:10,marginTop:5}}>Partial source unavailable: {e}</Text>)}
        {!data.errors.length?<Text style={{color:GREEN,fontSize:10,fontWeight:'800',marginTop:6}}>All five data sources returned successfully for this refresh.</Text>:null}
      </View>
    </ScrollView>
  </View>;
}
