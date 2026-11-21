import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const imageSignatureMatches=(bytes:Uint8Array,mime:string)=>{
 if(mime==="image/jpeg")return bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(mime==="image/png")return bytes.length>8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a;
 if(mime==="image/webp")return bytes.length>12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP";
 return false;
};
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const contentLength=Number(req.headers.get("content-length")||0);
 if(contentLength>15*1024*1024)return reply({error:"Request exceeds the 10 MB image upload limit"},413);
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return reply({error:"Sign in is required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),internalKey=Deno.env.get("BUNALENS_INTERNAL_FUNCTION_KEY");
 if(!url||!anon||!service||!internalKey)return reply({error:"Sync service is not configured"},503);
 try{
  const userClient=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await userClient.auth.getUser(token);
  if(userError||!userData.user)return reply({error:"Session is invalid or expired"},401);
  let body:Record<string,any>;
  try{body=await req.json()}catch{return reply({error:"Request body must be valid JSON"},400)}
  if(!body||typeof body!=="object"||Array.isArray(body))return reply({error:"Invalid request body"},400);
  const stationId=body.station_id,idempotencyKey=body.idempotency_key,sampleType=body.sample_type,woreda=body.woreda;
  const weight=Number(body.lot_weight_kg),mime=body.image_mime_type,batchCode=body.batch_code;
  const base64=typeof body.image_base64==="string"?body.image_base64.replace(/\s/g,""):"";
  if(typeof stationId!=="string"||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(stationId))return reply({error:"Invalid station"},400);
  if(typeof idempotencyKey!=="string"||!/^[a-zA-Z0-9_-]{8,128}$/.test(idempotencyKey))return reply({error:"Invalid idempotency key"},400);
  if(batchCode!==undefined&&(typeof batchCode!=="string"||!/^BNL-JMA-[A-Z0-9]{4}$/.test(batchCode)))return reply({error:"Invalid batch code"},400);
  if(!["red_cherry","green_bean"].includes(sampleType))return reply({error:"Invalid sample type"},400);
  if(!["Gomma","Limmu Kossa","Mana","Seka Chekorsa","Gera","Kersa","Jimma Town"].includes(woreda))return reply({error:"Invalid woreda"},400);
  if(!Number.isFinite(weight)||weight<=0||weight>100000)return reply({error:"Invalid lot weight"},400);
  if(!["image/jpeg","image/png","image/webp"].includes(mime)||!base64||base64.length>14_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))return reply({error:"Invalid image or image exceeds 10 MB"},413);
  let bytes:Uint8Array;
  try{bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}catch{return reply({error:"Image encoding is invalid"},400)}
  if(bytes.length===0||bytes.length>10*1024*1024||!imageSignatureMatches(bytes,mime))return reply({error:"Image content does not match its declared format or exceeds 10 MB"},415);
  const {data:station,error:stationError}=await userClient.from("stations").select("id").eq("id",stationId).eq("owner_id",userData.user.id).maybeSingle();
  if(stationError||!station)return reply({error:"Station access denied"},403);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:existing}=await db.from("coffee_batches").select("*").eq("station_id",stationId).eq("idempotency_key",idempotencyKey).maybeSingle();
  if(existing)return reply({batch:{id:existing.id,batch_code:existing.batch_code,sample_type:existing.sample_type,woreda:existing.woreda,created_at:existing.created_at,result:existing.grading_result,lot_weight_kg:Number(existing.lot_weight_kg),status:"synced",station_id:existing.station_id,verification_id:existing.verification_id,pricing:existing.pricing_result||undefined}});
  const gradeController=new AbortController();
  const gradeTimeout=setTimeout(()=>gradeController.abort(),40_000);
  let gradeResponse:Response;
  try{
   gradeResponse=await fetch(url+"/functions/v1/gemini-grade",{
    method:"POST",signal:gradeController.signal,
    headers:{"Content-Type":"application/json",apikey:anon,Authorization:"Bearer "+token,"x-bunalens-internal-key":internalKey},
    body:JSON.stringify({imageBase64:base64,mimeType:mime,sampleType,woreda,stationId,idempotencyKey})
   });
  }catch(error){
   if(error instanceof Error&&error.name==="AbortError")return reply({error:"AI grading timed out. Retry synchronization using the same sample."},504);
   return reply({error:"AI grading service is temporarily unreachable."},502);
  }finally{clearTimeout(gradeTimeout)}
  const gradePayload=await gradeResponse.json().catch(()=>({}));
  if(!gradeResponse.ok)return reply({error:gradePayload.error||"AI grading failed"},gradeResponse.status);
  const result=gradePayload.result;
  if(!result?.is_coffee_sample)return reply({error:result?.rejection_reason||"The image was not recognized as a coffee sample"},422);
  const lat=Number(body.gps_latitude),lng=Number(body.gps_longitude);
  const hasGps=Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
  const ext=mime==="image/png"?"png":mime==="image/webp"?"webp":"jpg";
  const imagePath=stationId+"/"+idempotencyKey+"."+ext;
  const {error:uploadError}=await db.storage.from("coffee-samples").upload(imagePath,bytes,{contentType:mime,upsert:true});
  if(uploadError){console.error("Sample upload failed",uploadError);return reply({error:"Could not store the sample image. Retry synchronization."},503)}
  const {data:benchmark}=await db.from("market_benchmarks").select("id,min_etb_per_feresula,max_etb_per_feresula,source_label,effective_date,is_demo").eq("sample_type",sampleType).eq("ecx_style_grade",result.ecx_grade).eq("active",true).order("effective_date",{ascending:false}).limit(1).maybeSingle();
  let pricing:any=undefined;
  if(benchmark){const mid=(Number(benchmark.min_etb_per_feresula)+Number(benchmark.max_etb_per_feresula))/2;pricing={benchmark_id:benchmark.id,source_label:benchmark.source_label,effective_date:benchmark.effective_date,is_demo:benchmark.is_demo,min_etb_per_feresula:Number(benchmark.min_etb_per_feresula),max_etb_per_feresula:Number(benchmark.max_etb_per_feresula),estimated_price_per_feresula_etb:Math.round(mid),estimated_price_per_kg_etb:Number((mid/17).toFixed(2)),estimated_lot_value_etb:Math.round(mid*weight/17),min_lot_value_etb:Math.round(Number(benchmark.min_etb_per_feresula)*weight/17),max_lot_value_etb:Math.round(Number(benchmark.max_etb_per_feresula)*weight/17),potential_sorting_gain_etb:Math.round((Number(benchmark.max_etb_per_feresula)-mid)*weight/17)};}
  const finalBatchCode=typeof batchCode==="string"?batchCode:"BNL-JMA-"+Math.random().toString(36).slice(2,6).toUpperCase();
  const {data:created,error:createError}=await db.from("coffee_batches").insert({
   id:idempotencyKey,station_id:stationId,batch_code:finalBatchCode,sample_type:sampleType,woreda,
   lot_weight_kg:weight,image_path:imagePath,grading_result:result,idempotency_key:idempotencyKey,
   pricing_result:pricing||null,gps_latitude:hasGps?lat:null,gps_longitude:hasGps?lng:null,created_at:body.captured_at||new Date().toISOString()
  }).select("id,batch_code,sample_type,woreda,created_at,lot_weight_kg,station_id,verification_id,grading_result,pricing_result").single();
  if(createError){
   console.error("Batch persistence failed",createError);
   return reply({error:"Assessment completed but cloud record could not be saved. Retry using the same capture."},503);
  }
  return reply({batch:{id:created.id,batch_code:created.batch_code,sample_type:created.sample_type,woreda:created.woreda,created_at:created.created_at,result:created.grading_result,lot_weight_kg:Number(created.lot_weight_kg),status:"synced",station_id:created.station_id,verification_id:created.verification_id,pricing:created.pricing_result||undefined,origin_coordinates:hasGps?{latitude:lat,longitude:lng}:undefined}});
 }catch(error){console.error("coffee-sync failed; request details omitted.");return reply({error:"Unable to synchronize this sample"},500)}
});
