// Hackathon sprint addition (Phase 7): Chapa checkout for coffee orders.
//
// Separate from chapa-initialize / chapa-webhook, which handle station credits
// and are unchanged. This function never touches station_payments.
//
// Signed-in calls (POST, JSON body, user token):
//   { action: "initialize", orderId, idempotencyKey }  buyer of an accepted order
//   { action: "verify", orderId }                       buyer or seller of the order
// Provider callback (GET or POST, no user token): ?trx_ref=...
//
// Nothing in a callback or a browser redirect is trusted. Every path asks
// Chapa's verify endpoint with the stored reference, and the database
// function compares reference, amount, currency and status before an order's
// payment status changes.
//
// TEST MODE ONLY: the function refuses to run unless CHAPA_SECRET_KEY is a
// Chapa test key, so no real money can move through this sprint build.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const httpStatus = (code?: string) => (code === "42501" ? 403 : code === "22023" ? 400 : 500);

async function chapa(path: string, secret: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch("https://api.chapa.co/v1/transaction/" + path, {
      ...init, signal: controller.signal, headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
    });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
  } finally { clearTimeout(timeout); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), secret = Deno.env.get("CHAPA_SECRET_KEY");
  if (!url || !anon || !service || !secret) return reply({ error: "Order payment service is not configured" }, 503);
  if (!secret.startsWith("CHASECK_TEST-")) return reply({ error: "Order payments run in Chapa test mode only in this build" }, 503);
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // Asks Chapa about one stored reference and applies the answer. Used by every path.
  const verify = async (txRef: string) => {
    let provider: { ok: boolean; status: number; body: any };
    try { provider = await chapa("verify/" + encodeURIComponent(txRef), secret); }
    catch { return reply({ error: "Chapa could not be reached. The payment stays pending; verify again." }, 502); }
    const data = provider.body?.data;
    const providerStatus = provider.ok && data?.status ? String(data.status) : provider.status === 404 ? "not_found" : "pending";
    const { data: applied, error } = await db.rpc("bunalens_apply_order_payment_result", {
      p_tx_ref: txRef, p_provider_status: providerStatus, p_provider_tx_ref: data?.tx_ref ?? null,
      p_amount: data?.amount === undefined || data?.amount === null ? null : Number(data.amount),
      p_currency: data?.currency ?? null,
      p_payload: { verify_status: provider.body?.status ?? null, data_status: data?.status ?? null, reference: data?.reference ?? null, mode: data?.mode ?? null, http_status: provider.status },
    });
    if (error) return reply({ error: error.code === "42501" ? "Payment reference not found" : "Payment result could not be recorded. Verify again." }, error.code === "42501" ? 404 : 503);
    return reply({ ...applied, provider_status: providerStatus, test_mode: true }, applied.result === "verified" || applied.result === "already_verified" ? 200 : 202);
  };

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let body: Record<string, unknown> = {};
    if (req.method === "POST") body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";

    // ---- Provider callback: only the reference is read from the request ----
    if (action !== "initialize" && action !== "verify") {
      const query = new URL(req.url).searchParams;
      const txRef = String(body.trx_ref || body.tx_ref || query.get("trx_ref") || query.get("tx_ref") || "");
      if (!/^BNLO-[0-9a-f]{32}$/.test(txRef)) return reply({ error: "Missing or invalid transaction reference" }, 400);
      return await verify(txRef);
    }

    // ---- Signed-in calls ----
    if (!token) return reply({ error: "Sign in is required" }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return reply({ error: "Session is invalid or expired" }, 401);
    const orderId = body.orderId;
    if (typeof orderId !== "string" || !UUID.test(orderId)) return reply({ error: "Invalid order" }, 400);

    if (action === "verify") {
      // Row-level security decides who may see the order: its buyer, its seller, or an administrator.
      const { data: visible } = await userClient.from("coffee_orders").select("id").eq("id", orderId).maybeSingle();
      if (!visible) return reply({ error: "Order not found" }, 403);
      const { data: payment } = await db.from("coffee_order_payments").select("chapa_tx_ref").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!payment) return reply({ error: "No payment has been started for this order" }, 404);
      return await verify(payment.chapa_tx_ref);
    }

    const idempotencyKey = body.idempotencyKey;
    if (typeof idempotencyKey !== "string") return reply({ error: "Invalid payment key" }, 400);
    const { data: started, error: startError } = await db.rpc("bunalens_begin_order_payment", {
      p_order_id: orderId, p_buyer_id: userData.user.id, p_idempotency_key: idempotencyKey, p_is_test: true,
    });
    if (startError) return reply({ error: startError.message }, httpStatus(startError.code));
    const answer = { tx_ref: started.tx_ref, amount_etb: Number(started.amount_etb), currency: "ETB", test_mode: true, expires_at: started.expires_at };
    if (started.reused && started.checkout_url) return reply({ ...answer, checkout_url: started.checkout_url, reused: true });

    const email = userData.user.email && !/\.(test|invalid|example|localhost)$/i.test(userData.user.email) ? userData.user.email : undefined;
    const returnUrl = Deno.env.get("CHAPA_ORDER_RETURN_URL");
    let provider: { ok: boolean; status: number; body: any };
    try {
      provider = await chapa("initialize", secret, {
        method: "POST",
        body: JSON.stringify({
          amount: String(started.amount_etb), currency: "ETB", tx_ref: started.tx_ref, ...(email ? { email } : {}),
          first_name: "BunaLens", last_name: "Buyer",
          callback_url: Deno.env.get("CHAPA_ORDER_CALLBACK_URL") || url + "/functions/v1/chapa-order-payment",
          ...(returnUrl ? { return_url: returnUrl } : {}),
          customization: { title: "BunaLens Order", description: "Coffee order payment TEST" },
        }),
      });
    } catch {
      // The reference stays pending. A retry returns the same reference and tries Chapa again.
      return reply({ error: "Chapa could not be reached. Retry with the same payment." }, 502);
    }
    const checkoutUrl = provider.body?.data?.checkout_url;
    if (!provider.ok || provider.body?.status !== "success" || typeof checkoutUrl !== "string") {
      await db.rpc("bunalens_apply_order_payment_result", {
        p_tx_ref: started.tx_ref, p_provider_status: "init_failed", p_provider_tx_ref: null, p_amount: null, p_currency: null,
        p_payload: { initialize_http_status: provider.status, message: typeof provider.body?.message === "string" ? provider.body.message.slice(0, 300) : provider.body?.message ?? null },
      });
      return reply({ error: "Chapa could not start this payment", provider_message: typeof provider.body?.message === "string" ? provider.body.message.slice(0, 200) : undefined }, 502);
    }
    await db.from("coffee_order_payments").update({ checkout_url: checkoutUrl }).eq("chapa_tx_ref", started.tx_ref);
    return reply({ ...answer, checkout_url: checkoutUrl, reused: false });
  } catch {
    console.error("chapa-order-payment failed; request details omitted.");
    return reply({ error: "Unable to process the order payment" }, 500);
  }
});
