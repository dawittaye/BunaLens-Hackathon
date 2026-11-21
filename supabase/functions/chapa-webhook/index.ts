import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method!=="GET"&&req.method!=="POST")return reply({error:"Method not allowed"},405);
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),secret=Deno.env.get("CHAPA_SECRET_KEY");
 if(!url||!service||!secret)return reply({error:"Payment verifier is not configured"},503);
 try{
  let txRef=new URL(req.url).searchParams.get("trx_ref")||new URL(req.url).searchParams.get("tx_ref")||"";
  if(req.method==="POST"){const body=await req.json().catch(()=>({}));txRef=String(body.trx_ref||body.tx_ref||txRef)}
  if(!txRef||txRef.length>128)return reply({error:"Missing transaction reference"},400);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:payment,error:paymentError}=await db.from("station_payments").select("id,package_id,amount_etb,currency,status").eq("chapa_tx_ref",txRef).maybeSingle();
  if(paymentError||!payment)return reply({error:"Payment reference not found"},404);
  if(payment.status==="verified")return reply({ok:true,status:"verified",already_applied:true});
  const verifyController=new AbortController();
  const verifyTimeout=setTimeout(()=>verifyController.abort(),15_000);
  let verifyResponse:Response;
  try{
   verifyResponse=await fetch("https://api.chapa.co/v1/transaction/verify/"+encodeURIComponent(txRef),{
    signal:verifyController.signal,headers:{"Authorization":"Bearer "+secret}
   });
  }catch(error){
   if(error instanceof Error&&error.name==="AbortError")return reply({error:"Payment verification timed out; provider confirmation will be retried."},504);
   return reply({error:"Payment provider is temporarily unreachable."},502);
  }finally{clearTimeout(verifyTimeout)}
  const verify=await verifyResponse.json().catch(()=>({}));
  const data=verify?.data;
  const success=verifyResponse.ok&&String(data?.status||"").toLowerCase()==="success"&&String(data?.tx_ref||"")===txRef&&String(data?.currency||"").toUpperCase()===payment.currency&&Number(data?.amount)===Number(payment.amount_etb);
  if(!success){
   if(String(data?.status||"").toLowerCase()==="failed")await db.from("station_payments").update({status:"failed",provider_payload:verify}).eq("chapa_tx_ref",txRef);
   return reply({ok:false,status:String(data?.status||"pending"),message:"Payment is not verified as successful"},202);
  }
  const {data:applied,error:applyError}=await db.rpc("apply_verified_chapa_payment",{p_tx_ref:txRef,p_provider_payload:verify});
  if(applyError){console.error("Could not apply verified payment",applyError);return reply({error:"Payment verified but entitlement update needs retry"},503)}
  return reply({ok:true,status:"verified",payment:applied});
 }catch(error){console.error("chapa-webhook failed; request details omitted.");return reply({error:"Unable to verify payment"},500)}
});
