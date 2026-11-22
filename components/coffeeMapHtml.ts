export type CoffeeMapSite = { id: string; name: string; short: string; lat: number; lon: number };
export type CoffeeMapPoint = { decimalLatitude: number; decimalLongitude: number; scientificName?: string; establishmentMeans?: string; basisOfRecord?: string; key?: number };

export function buildCoffeeMapHtml(site: CoffeeMapSite, points: CoffeeMapPoint[], zoom: boolean) {
  const config = JSON.stringify({ site, points: points.slice(0, 300), zoom }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<link href="https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css" rel="stylesheet" />
<style>
html,body,#map{height:100%;width:100%;margin:0;padding:0;overflow:hidden;font-family:system-ui,sans-serif}
#map{background:#25382d}.maplibregl-ctrl-group{border-radius:10px!important;overflow:hidden}
.maplibregl-ctrl-attrib{font-size:9px!important}
#status{position:absolute;z-index:5;left:10px;right:10px;bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.95);color:#26372d;font-size:11px;box-shadow:0 1px 5px #0004}
#locate{position:absolute;z-index:6;right:10px;top:10px;border:0;border-radius:9px;padding:9px 11px;background:#26372d;color:white;font-weight:700;font-size:11px;box-shadow:0 1px 5px #0005}
.pin{width:17px;height:17px;border:2px solid white;border-radius:50%;box-shadow:0 1px 5px #000a}.pin.selected{width:22px;height:22px;border:3px solid #fff}
</style></head><body>
<div id="map" role="application" aria-label="NASA satellite map of Ethiopia and Jimma coffee origins"></div>
<button id="locate" type="button">My location</button><div id="status">Loading NASA satellite imagery and Jimma administrative boundary…</div>
<script src="https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js"></script>
<script>
(function(){
 const config = ${config};
 const status=document.getElementById('status');
 const report=message=>{status.textContent=message;try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'status',message}));}catch(_){}};
 const map=new maplibregl.Map({
  container:'map',
  style:{
   version:8,
   sources:{
    'nasa-satellite':{
     type:'raster',
     tiles:['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg'],
     tileSize:256,
     maxzoom:9,
     attribution:'Satellite imagery © NASA EOSDIS GIBS · MODIS Terra'
    }
   },
   layers:[{id:'nasa-satellite-layer',type:'raster',source:'nasa-satellite'}]
  },
  center:config.zoom?[36.72,7.72]:[40.49,9.15],
  zoom:config.zoom?8.5:5.2,
  maxZoom:13,
  attributionControl:true
 });
 map.addControl(new maplibregl.NavigationControl({showCompass:true}),'top-left');
 map.addControl(new maplibregl.FullscreenControl(),'top-left');
 const bounds=new maplibregl.LngLatBounds();
 const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function addMarker(lon,lat,title,description,selected,color){
  const el=document.createElement('div');el.className='pin'+(selected?' selected':'');el.style.background=color;
  new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([lon,lat]).setPopup(new maplibregl.Popup({offset:12}).setHTML('<strong>'+escapeText(title)+'</strong><br>'+escapeText(description))).addTo(map);
 }
 const sites=${JSON.stringify([
  {id:'jarc',name:'JARC Research Plots (Melko)',lat:7.6667,lon:36.7833},
  {id:'gomma',name:'Gomma Forest Coffee',lat:7.85,lon:36.65},
  {id:'mana',name:'Mana Highland Coffee',lat:7.75,lon:36.75},
  {id:'gera',name:'Gera Wild Forest Coffee',lat:7.7333,lon:36.25},
  {id:'limu',name:'Limu Kossa Plantation',lat:7.95,lon:36.95}
 ])};
 map.on('load',async function(){
  sites.forEach(s=>addMarker(s.lon,s.lat,s.name,s.lat.toFixed(4)+', '+s.lon.toFixed(4),s.id===config.site.id,s.id===config.site.id?'#f0a34a':'#22a06b'));
  config.points.forEach(p=>{if(Number.isFinite(p.decimalLatitude)&&Number.isFinite(p.decimalLongitude))addMarker(p.decimalLongitude,p.decimalLatitude,'GBIF Coffea arabica',p.establishmentMeans||'Native occurrence',false,'#a84d39');});
  try{
   const [cm,jm]=await Promise.all([fetch('https://www.geoboundaries.org/api/current/gbOpen/ETH/ADM0/'),fetch('https://www.geoboundaries.org/api/current/gbOpen/ETH/ADM2/')]);
   if(!cm.ok||!jm.ok)throw new Error('geoBoundaries metadata request failed ('+cm.status+'/'+jm.status+').');
   const [countryMeta,jimmaMeta]=await Promise.all([cm.json(),jm.json()]);
   const [cr,jr]=await Promise.all([fetch(countryMeta.simplifiedGeometryGeoJSON||countryMeta.gjDownloadURL),fetch(jimmaMeta.simplifiedGeometryGeoJSON||jimmaMeta.gjDownloadURL)]);
   if(!cr.ok||!jr.ok)throw new Error('geoBoundaries GeoJSON download failed ('+cr.status+'/'+jr.status+').');
   const [countryGeo,jimmaGeo]=await Promise.all([cr.json(),jr.json()]);
   map.addSource('ethiopia-boundary',{type:'geojson',data:countryGeo});
   map.addLayer({id:'ethiopia-line',type:'line',source:'ethiopia-boundary',paint:{'line-color':'#ffffff','line-width':1.5,'line-opacity':0.85}});
   const features=(jimmaGeo.features||[]).filter(feature=>{
    const p=feature.properties||{};
    const names=['shapeName','shapeName_en','ADM2_EN','ADM2_NAME','NAME_2','name','NAME'];
    return names.some(key=>String(p[key]||'').toLowerCase().includes('jimma'));
   });
   if(!features.length)throw new Error('Jimma Zone was not found in the current Ethiopia ADM2 boundary dataset.');
   map.addSource('jimma-boundary',{type:'geojson',data:{type:'FeatureCollection',features}});
   map.addLayer({id:'jimma-fill',type:'fill',source:'jimma-boundary',paint:{'fill-color':'#16a36a','fill-opacity':0.16}});
   map.addLayer({id:'jimma-outline-casing',type:'line',source:'jimma-boundary',paint:{'line-color':'#17251c','line-width':5,'line-opacity':0.9}});
   map.addLayer({id:'jimma-line',type:'line',source:'jimma-boundary',paint:{'line-color':'#ffd166','line-width':2.8,'line-opacity':1}});
   const collect=coords=>{if(!Array.isArray(coords))return;if(typeof coords[0]==='number'&&typeof coords[1]==='number'){bounds.extend([coords[0],coords[1]]);return;}coords.forEach(collect);};
   features.forEach(f=>collect(f.geometry&&f.geometry.coordinates));
   if(config.zoom&&!bounds.isEmpty())map.fitBounds(bounds,{padding:42,maxZoom:9});
   report('Satellite map ready · Jimma boundary visible · '+sites.length+' coffee sites · '+config.points.length+' GBIF records');
  }catch(error){
   report((error&&error.message?error.message:'Jimma boundary could not be loaded.')+' Coffee-site markers remain visible.');
  }
 });
 function setUserLocation(lat,lon){if(!Number.isFinite(lat)||!Number.isFinite(lon))return;addMarker(lon,lat,'Your location','Current device location',true,'#2764c5');map.flyTo({center:[lon,lat],zoom:9});}
 window.setCoffeeMapUserLocation=setUserLocation;
 document.getElementById('locate').addEventListener('click',()=>{
  if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage('REQUEST_LOCATION');return;}
  if(!navigator.geolocation){report('Location is not available in this browser.');return;}
  report('Requesting your location…');
  navigator.geolocation.getCurrentPosition(p=>setUserLocation(p.coords.latitude,p.coords.longitude),e=>report(e.code===1?'Location permission was denied.':'Unable to determine your location.'),{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
 });
})();
</script></body></html>`;
}
