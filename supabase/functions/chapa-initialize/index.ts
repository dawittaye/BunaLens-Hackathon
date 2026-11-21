import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const packages={starter_50:{amount:500},station_pro_monthly:{amount:2500}};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const contentLength=Number(req.headers.get("content-length")||0);
 if(contentLength>16*1024)return reply({error:"Request body is too large"},413);
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return reply({error:"Sign in is required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),chapa=Deno.env.get("CHAPA_SECRET_KEY");
 if(!url||!anon||!service||!chapa)return reply({error:"Payment service is not configured"},503);
 try{
  const userClient=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await userClient.auth.getUser(token);
  if(userError||!userData.user?.email)return reply({error:"A valid signed-in email account is required"},401);
  let body:Record<string,unknown>;
  try{body=await req.json()}catch{return reply({error:"Request body must be valid JSON"},400)}
  if(!body||typeof body!=="object"||Array.isArray(body))return reply({error:"Invalid request body"},400);
  const stationId=body.stationId;const packageId=body.packageId;const idempotencyKey=body.idempotencyKey;
  if(typeof stationId!=="string"||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(stationId))return reply({error:"Invalid station"},400);
  if(typeof packageId!=="string"||!Object.prototype.hasOwnProperty.call(packages,packageId))return reply({error:"Unsupported package"},400);
  if(typeof idempotencyKey!=="string"||idempotencyKey.length<8||idempotencyKey.length>128)return reply({error:"Invalid idempotency key"},400);
  const serviceClient=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:station,error:stationError}=await userClient.from("stations").select("id,name,manager").eq("id",stationId).eq("owner_id",userData.user.id).maybeSingle();
  if(stationError||!station)return reply({error:"Station access denied"},403);
  const {data:existing}=await serviceClient.from("station_payments").select("id,chapa_tx_ref,checkout_url,status").eq("station_id",stationId).eq("idempotency_key",idempotencyKey).maybeSingle();
  if(existing?.checkout_url&&existing.status==="pending")return reply({checkout_url:existing.checkout_url,tx_ref:existing.chapa_tx_ref});
  if(existing?.status==="pending")return reply({error:"This payment initialization is still processing. Retry shortly with the same checkout."},409);
  if(existing?.status==="verified")return reply({error:"This checkout was already paid. Start a new top-up to create another transaction."},409);
  const txRef="BNL-"+crypto.randomUUID();
  const amount=packages[packageId as keyof typeof packages].amount;
  let paymentId:string;
  if(existing){
   const {error:updateError}=await serviceClient.from("station_payments").update({
    package_id:packageId,amount_etb:amount,currency:"ETB",chapa_tx_ref:txRef,status:"pending",
    checkout_url:null,provider_payload:null
   }).eq("id",existing.id);
   if(updateError)return reply({error:"Could not reset the failed payment attempt. Retry later."},409);
   paymentId=existing.id;
  }else{
   const {data:payment,error:insertError}=await serviceClient.from("station_payments").insert({
    station_id:stationId,package_id:packageId,amount_etb:amount,currency:"ETB",
    chapa_tx_ref:txRef,idempotency_key:idempotencyKey,status:"pending"
   }).select("id").single();
   if(insertError)return reply({error:"Could not create payment record. Retry with the same idempotency key."},409);
   paymentId=payment.id;
  }
  const fullName=String(userData.user.user_metadata?.full_name||station.manager||"BunaLens Customer").trim().split(/\s+/);
  const callbackUrl=Deno.env.get("CHAPA_CALLBACK_URL")||url+"/functions/v1/chapa-webhook";
  const returnUrl=Deno.env.get("CHAPA_RETURN_URL");
  const chapaController=new AbortController();
  const chapaTimeout=setTimeout(()=>chapaController.abort(),20_000);
  let chapaResponse:Response;
  try{
   chapaResponse=await fetch("https://api.chapa.co/v1/transaction/initialize",{
   method:"POST",signal:chapaController.signal,
   headers:{"Authorization":"Bearer "+chapa,"Content-Type":"application/json"},
   body:JSON.stringify({
    amount:String(amount),currency:"ETB",email:userData.user.email,
    first_name:fullName[0]||"BunaLens",last_name:fullName.slice(1).join(" ")||"Station",
    tx_ref:txRef,callback_url:callbackUrl,...(returnUrl?{return_url:returnUrl}:{}),
    customization:{title:"BunaLens Station",description:packageId==="starter_50"?"50 coffee batch scans":"30-day washing station Pro pass"}
   })
   });
  }catch(error){
   if(error instanceof Error&&error.name==="AbortError")return reply({error:"Chapa initialization timed out. Retry with the same payment reference."},504);
   return reply({error:"Chapa is temporarily unreachable."},502);
  }finally{clearTimeout(chapaTimeout)}
  const result=await chapaResponse.json().catch(()=>({}));
  const checkoutUrl=result?.data?.checkout_url;
  if(!chapaResponse.ok||result?.status!=="success"||typeof checkoutUrl!=="string"){
   await serviceClient.from("station_payments").update({status:"failed",provider_payload:result}).eq("id",paymentId);
   return reply({error:"Chapa could not initialize this payment"},502);
  }
  await serviceClient.from("station_payments").update({checkout_url:checkoutUrl,provider_payload:{initialize_status:result.status}}).eq("id",paymentId);
  return reply({checkout_url:checkoutUrl,tx_ref:txRef});
 }catch(error){console.error("chapa-initialize failed; request details omitted.");return reply({error:"Unable to initialize payment"},500)}
});
