import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Content-Type":"application/json"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="GET")return reply({error:"Method not allowed"},405);
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!service)return reply({error:"Verification service unavailable"},503);
 const parts=new URL(req.url).pathname.split("/").filter(Boolean);
 const verificationId=decodeURIComponent(parts[parts.length-1]||new URL(req.url).searchParams.get("id")||"");
 if(!/^[0-9a-f-]{36}$/i.test(verificationId))return reply({error:"Invalid verification identifier"},400);
 try{
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data,error}=await db.from("coffee_batches").select("verification_id,batch_code,sample_type,woreda,created_at,lot_weight_kg,grading_result").eq("verification_id",verificationId).maybeSingle();
  if(error||!data)return reply({valid:false,error:"No certificate matches this verification identifier"},404);
  return reply({valid:true,certificate:{
   verification_id:data.verification_id,batch_code:data.batch_code,sample_type:data.sample_type,
   origin_woreda:data.woreda,assessed_at:data.created_at,lot_weight_kg:Number(data.lot_weight_kg),
   estimated_grade:data.grading_result?.ecx_grade||null,quality_score:data.grading_result?.quality_score??null,
   disclaimer:"AI-assisted visual assessment — not an official ECX laboratory certificate."
  }});
 }catch(error){console.error("certificate verification failed",error);return reply({error:"Unable to verify certificate"},500)}
});
