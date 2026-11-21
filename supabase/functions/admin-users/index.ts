import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply({ error: "Administrator sign-in is required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply({ error: "User management service is not configured" }, 503);

  try {
    const callerClient = createClient(url, anon, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
    if (callerError || !callerData.user) return reply({ error: "Session is invalid or expired" }, 401);
    if (callerData.user.app_metadata?.role !== "admin") return reply({ error: "Administrator access is required" }, 403);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply({ error: "Request body must be valid JSON" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid request body" }, 400);

    const action = typeof body.action === "string" ? body.action : "list";
    if (action === "suspend" || action === "reactivate") {
      const targetId = typeof body.userId === "string" ? body.userId : "";
      if (!targetId) return reply({ error: "A user ID is required" }, 400);
      if (targetId === callerData.user.id) return reply({ error: "You cannot suspend your own administrator account" }, 400);

      const { data: targetResult, error: targetError } = await admin.auth.admin.getUserById(targetId);
      if (targetError || !targetResult.user) return reply({ error: "User account was not found" }, 404);
      if (targetResult.user.app_metadata?.role === "admin") {
        return reply({ error: "Administrator accounts cannot be suspended from this screen" }, 403);
      }

      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(targetId, {
        ban_duration: action === "suspend" ? "876000h" : "none",
      });
      if (updateError || !updated.user) return reply({ error: "Could not update this account" }, 500);

      await admin.from("user_activity_logs").insert({
        user_id: callerData.user.id,
        event_type: "admin_action",
        metadata: { action, target_user_id: targetId },
      });
      return reply({ success: true, userId: targetId, banned_until: (updated.user as typeof updated.user & { banned_until?: string | null }).banned_until ?? null });
    }

    if (action !== "list") return reply({ error: "Unsupported action" }, 400);
    const page = Math.max(1, Math.min(10000, Number(body.page) || 1));
    const perPage = Math.max(10, Math.min(100, Number(body.perPage) || 50));

    // Supabase Auth Admin is the source of truth for account identity and status.
    // Read all pages for accurate summary counts, while returning only one page.
    const allUsers: any[] = [];
    for (let authPage = 1; authPage <= 50; authPage += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page: authPage, perPage: 1000 });
      if (error) return reply({ error: "Could not load registered users" }, 502);
      const pageUsers = data.users || [];
      allUsers.push(...pageUsers);
      if (pageUsers.length < 1000) break;
    }

    const now = Date.now();
    const isSuspended = (user: any) => Boolean(user.banned_until && new Date(user.banned_until).getTime() > now);
    const summary = {
      total: allUsers.length,
      active30d: allUsers.filter((user) => !isSuspended(user) && user.last_sign_in_at && now - new Date(user.last_sign_in_at).getTime() <= 30 * 86400000).length,
      verified: allUsers.filter((user) => Boolean(user.email_confirmed_at || user.phone_confirmed_at)).length,
      unverified: allUsers.filter((user) => !user.email_confirmed_at && !user.phone_confirmed_at).length,
      suspended: allUsers.filter(isSuspended).length,
    };

    allUsers.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const pageUsers = allUsers.slice((page - 1) * perPage, page * perPage);
    const userIds = pageUsers.map((user) => user.id);
    const { data: stationRows, error: stationError } = userIds.length
      ? await admin.from("stations").select("id,owner_id,name,station_name,manager,owner_name,email,phone,woreda,created_at").in("owner_id", userIds)
      : { data: [], error: null };
    if (stationError) return reply({ error: "Could not load station associations" }, 502);

    const stationIds = (stationRows || []).map((station: any) => station.id);
    const { data: batchRows, error: batchError } = stationIds.length
      ? await admin.from("coffee_batches").select("id,station_id").in("station_id", stationIds).eq("is_demo", false)
      : { data: [], error: null };
    if (batchError) return reply({ error: "Could not load user assessment activity" }, 502);

    const stationsByOwner = new Map<string, any>();
    for (const station of stationRows || []) stationsByOwner.set(station.owner_id, station);
    const batchesByStation = new Map<string, number>();
    for (const batch of batchRows || []) batchesByStation.set(batch.station_id, (batchesByStation.get(batch.station_id) || 0) + 1);

    const users = pageUsers.map((user) => {
      const station = stationsByOwner.get(user.id) || null;
      const suspended = isSuspended(user);
      return {
        id: user.id,
        email: user.email || null,
        phone: user.phone || null,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at || null,
        email_confirmed_at: user.email_confirmed_at || null,
        phone_confirmed_at: user.phone_confirmed_at || null,
        banned_until: user.banned_until || null,
        role: user.app_metadata?.role || "user",
        full_name: user.user_metadata?.full_name || user.user_metadata?.manager || station?.owner_name || station?.manager || null,
        station: station ? {
          id: station.id,
          name: station.station_name || station.name || null,
          woreda: station.woreda,
          phone: station.phone,
        } : null,
        batch_count: station ? (batchesByStation.get(station.id) || 0) : 0,
        status: suspended ? "suspended" : (user.email_confirmed_at || user.phone_confirmed_at) ? "verified" : "unverified",
      };
    });

    const { data: activity, error: activityError } = await admin
      .from("user_activity_logs")
      .select("id,user_id,event_type,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (activityError && activityError.code !== "42P01") return reply({ error: "Could not load user activity" }, 502);

    return reply({
      users,
      activity: activity || [],
      summary,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(allUsers.length / perPage)),
    });
  } catch (error) {
    console.error("admin-users failed", error instanceof Error ? error.message : "unknown error");
    return reply({ error: "Unable to complete the user management request" }, 500);
  }
});
