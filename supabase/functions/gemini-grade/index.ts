import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-bunalens-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const percentKeys = ["sound_or_ripe_pct", "unripe_green_pct", "black_overfermented_pct", "insect_broken_pct", "foreign_matter_pct"] as const;
const grades = ["Unclassified"] as const;
// Optional qualitative fields. They are never required, so an older model response stays valid.
const photoIssues = ["blurry", "too_dark", "glare", "too_few_visible", "overlapping", "partial_view"] as const;
const sizeVariations = ["appears_uniform", "appears_mixed", "not_assessable"] as const;
const readiness = ["Specialty Export", "Commercial Export", "Local Market Only", "Reject / Re-sort", "Insufficient Evidence"] as const;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
const imageSignatureMatches = (bytes: Uint8Array, mime: string) => {
  if (mime === "image/jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (mime === "image/webp") return bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
};

function validateAssessment(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Model response was not an object.");
  const v = raw as Record<string, unknown>;
  if (typeof v.is_coffee_sample !== "boolean") throw new Error("Missing sample classification.");
  if (v.rejection_reason !== undefined && typeof v.rejection_reason !== "string") throw new Error("Invalid rejection reason.");
  if (!grades.includes(v.ecx_grade as typeof grades[number])) throw new Error("Unvalidated grade mapping is not permitted.");
  if (typeof v.quality_score !== "number" || !Number.isFinite(v.quality_score) || v.quality_score < 0 || v.quality_score > 100) throw new Error("Invalid quality score.");
  if (typeof v.confidence_score !== "number" || !Number.isFinite(v.confidence_score) || v.confidence_score < 0 || v.confidence_score > 100) throw new Error("Invalid confidence score.");
  if (!v.breakdown || typeof v.breakdown !== "object" || Array.isArray(v.breakdown)) throw new Error("Missing defect breakdown.");
  const b = v.breakdown as Record<string, unknown>;
  if (percentKeys.some((key) => typeof b[key] !== "number" || !Number.isFinite(b[key]) || Number(b[key]) < 0 || Number(b[key]) > 100)) throw new Error("Invalid defect percentages.");
  const total = percentKeys.reduce((sum, key) => sum + Number(b[key]), 0);
  if (Math.abs(total - 100) > 2) throw new Error("Defect percentages must total approximately 100.");
  if (!readiness.includes(v.export_readiness as typeof readiness[number])) throw new Error("Invalid readiness label.");
  if (typeof v.sorting_action_advice !== "string" || !v.sorting_action_advice.trim()) throw new Error("Missing sorting advice.");
  if (!Array.isArray(v.assessment_limitations) || v.assessment_limitations.some((x) => typeof x !== "string")) throw new Error("Missing assessment limitations.");
  const normalized = Object.fromEntries(percentKeys.map((key) => [key, Number((Number(b[key]) * 100 / total).toFixed(1))]));
  return {
    is_coffee_sample: v.is_coffee_sample,
    ...(typeof v.rejection_reason === "string" ? { rejection_reason: v.rejection_reason.slice(0, 300) } : {}),
    ecx_grade: v.ecx_grade,
    quality_score: v.quality_score,
    confidence_score: v.confidence_score,
    breakdown: normalized,
    estimated_price_per_feresula_etb: 0,
    potential_gain_if_sorted_etb: 0,
    export_readiness: v.export_readiness,
    sorting_action_advice: v.sorting_action_advice.slice(0, 1000),
    assessment_limitations: [...(v.assessment_limitations as string[]).slice(0, 11).map((s) => s.slice(0, 300)), "No validated ECX-style grade mapping is configured; the visual result is therefore Unclassified."],
    assessment_method: "ai_visual_estimate" as const,
    ...(Array.isArray(v.photo_issues) ? { photo_issues: (v.photo_issues as unknown[]).filter((x): x is typeof photoIssues[number] => photoIssues.includes(x as typeof photoIssues[number])).slice(0, 6) } : {}),
    ...(sizeVariations.includes(v.apparent_size_variation as typeof sizeVariations[number]) ? { apparent_size_variation: v.apparent_size_variation as typeof sizeVariations[number] } : {}),
    ...(Array.isArray(v.visible_observations) ? { visible_observations: (v.visible_observations as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 4).map((s) => s.slice(0, 240)) } : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 15 * 1024 * 1024) return json({ error: "Request exceeds the 10 MB image upload limit." }, 413);
  const internalKey = Deno.env.get("BUNALENS_INTERNAL_FUNCTION_KEY");
  if (!internalKey || req.headers.get("x-bunalens-internal-key") !== internalKey) return json({ error: "This grading endpoint is internal to the sync service." }, 403);
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || token === authHeader) return json({ error: "A signed-in user session is required." }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!supabaseUrl || !anonKey || !geminiKey) return json({ error: "Server-side grading is not configured." }, 503);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Session is invalid or expired." }, 401);
    let body: Record<string, any>;
    try { body = await req.json(); }
    catch { return json({ error: "Request body must be valid JSON." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request body." }, 400);
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s/g, "") : "";
    const mimeType = body.mimeType, sampleType = body.sampleType, woreda = body.woreda;
    const stationId = body.stationId, idempotencyKey = body.idempotencyKey;
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return json({ error: "Unsupported image format." }, 400);
    if (!["red_cherry", "green_bean"].includes(sampleType)) return json({ error: "Invalid coffee sample type." }, 400);
    if (!["Gomma", "Limmu Kossa", "Mana", "Seka Chekorsa", "Gera", "Kersa", "Jimma Town"].includes(woreda)) return json({ error: "Invalid origin woreda." }, 400);
    if (typeof stationId !== "string" || !/^[0-9a-f-]{36}$/i.test(stationId)) return json({ error: "A registered washing station is required for cloud grading." }, 400);
    if (typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(idempotencyKey)) return json({ error: "A valid capture idempotency key is required." }, 400);
    if (!imageBase64 || imageBase64.length > 14_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) return json({ error: "Image is missing, malformed or exceeds the 10 MB limit." }, 413);
    let imageBytes: Uint8Array;
    try { imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0)); }
    catch { return json({ error: "Image encoding is invalid." }, 400); }
    if (imageBytes.length === 0 || imageBytes.length > 10 * 1024 * 1024 || !imageSignatureMatches(imageBytes, mimeType)) return json({ error: "Image content does not match its declared format or exceeds 10 MB." }, 415);
    const { data: station, error: stationError } = await userClient.from("stations").select("id,owner_id,credits,pro_expires_at").eq("id", stationId).eq("owner_id", userData.user.id).maybeSingle();
    if (stationError || !station) return json({ error: "You do not have access to this washing station." }, 403);
    const proActive = station.pro_expires_at && new Date(station.pro_expires_at).getTime() > Date.now();
    if (!proActive && Number(station.credits) < 1) return json({ error: "No scan credits are available." }, 402);

    const sampleInstructions = sampleType === "red_cherry"
      ? "RED CHERRY criteria: assess visible cherry maturity and uniformity. Sound/ripe means visibly mature red cherries; unripe means green or visibly immature cherries; black/overfermented means visibly blackened, shrivelled or rotten fruit; insect/broken means visible pest damage or physically broken fruit; foreign matter means leaves, twigs, stones or non-coffee material."
      : "GREEN BEAN criteria: sound means intact, visually normal green coffee beans; unripe/immature means visibly pale, malformed or immature-looking beans (do not infer density); black/overfermented means visibly black, discoloured or fermented-looking beans; insect/broken means visible insect holes, insect damage, chips or broken beans; foreign matter means husk, parchment, stones, wood or other non-bean material.";
    const prompt = `You are BunaLens, a conservative visual coffee-sample screening assistant with contextual knowledge of Ethiopian Arabica production and Jimma Zone origins. This is NOT official ECX grading and you are NOT an ECX Q-Grader. Analyze only what is directly visible in the submitted photograph.
Sample type: ${sampleType}. Origin: ${woreda}, Jimma Zone, Ethiopia.
${sampleInstructions}
First assess image suitability: focus/sharpness, lighting, glare/shadows, sample coverage, approximate visible sample size, overlap/crowding, and whether the image actually depicts the selected coffee type. If unrelated, set is_coffee_sample=false and give a short rejection_reason. If it is coffee but image quality or sample coverage is inadequate, keep is_coffee_sample=true, set ecx_grade="Unclassified", export_readiness="Insufficient Evidence", lower confidence_score, explain limitations, and do not overstate the percentages.
Estimate five mutually exclusive visible composition percentages that sum to 100. State uncertainty. Do not infer moisture, water activity, cup quality, aroma, screen size, density, laboratory results, hidden defects, export compliance, or official grade. Do not invent prices, buyer offers or financial outcomes. Always set ecx_grade="Unclassified", estimated_price_per_feresula_etb=0 and potential_gain_if_sorted_etb=0 because no validated grading-to-price methodology is configured. Use "Insufficient Evidence" unless the visible image is genuinely clear; readiness is a cautious visual sorting cue only, not export approval.
Optionally report photo_issues (any of: blurry, too_dark, glare, too_few_visible, overlapping, partial_view), apparent_size_variation (appears_uniform, appears_mixed or not_assessable; a relative visual impression only, never a measured or screen size), and up to four short visible_observations about visible damage, discolouration or cherry ripeness.
Return only JSON. Include specific, actionable sorting_action_advice and an assessment_limitations array. assessment_method must be "ai_visual_estimate". confidence_score is 0-100.`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);
    let modelResponse: Response;
    try {
      modelResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=" + encodeURIComponent(geminiKey), {
        method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
          generationConfig: {
            temperature: 0.1, responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                is_coffee_sample: { type: "BOOLEAN" }, rejection_reason: { type: "STRING" },
                ecx_grade: { type: "STRING", enum: grades }, quality_score: { type: "NUMBER" }, confidence_score: { type: "NUMBER" },
                breakdown: { type: "OBJECT", properties: {
                  sound_or_ripe_pct: { type: "NUMBER" }, unripe_green_pct: { type: "NUMBER" },
                  black_overfermented_pct: { type: "NUMBER" }, insect_broken_pct: { type: "NUMBER" }, foreign_matter_pct: { type: "NUMBER" },
                }, required: [...percentKeys] },
                export_readiness: { type: "STRING", enum: readiness }, sorting_action_advice: { type: "STRING" },
                assessment_limitations: { type: "ARRAY", items: { type: "STRING" } },
                estimated_price_per_feresula_etb: { type: "NUMBER" }, potential_gain_if_sorted_etb: { type: "NUMBER" },
                photo_issues: { type: "ARRAY", items: { type: "STRING", enum: photoIssues } },
                apparent_size_variation: { type: "STRING", enum: sizeVariations },
                visible_observations: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["is_coffee_sample", "ecx_grade", "quality_score", "confidence_score", "breakdown", "export_readiness", "sorting_action_advice", "assessment_limitations", "estimated_price_per_feresula_etb", "potential_gain_if_sorted_etb"],
            },
          },
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return json({ error: "AI grading timed out. Retake the photograph or retry later." }, 504);
      return json({ error: "AI grading provider is temporarily unreachable." }, 502);
    } finally { clearTimeout(timeout); }
    if (!modelResponse.ok) {
      console.error("Gemini request failed", modelResponse.status);
      return json({ error: "AI grading provider is temporarily unavailable." }, 502);
    }
    const modelJson = await modelResponse.json();
    const candidateText = modelJson?.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => typeof p.text === "string")?.text;
    if (typeof candidateText !== "string") return json({ error: "AI provider returned no assessment." }, 502);
    let assessment: ReturnType<typeof validateAssessment>;
    try { assessment = validateAssessment(JSON.parse(candidateText)); }
    catch (error) {
      console.error("Invalid Gemini structured response", error);
      return json({ error: "AI provider returned an invalid or incomplete assessment. Retake the photograph." }, 502);
    }
    if (assessment.is_coffee_sample) {
      const { data: debitOk, error: debitError } = await userClient.rpc("consume_station_scan_credit", { p_station_id: stationId, p_idempotency_key: idempotencyKey });
      if (debitError) { console.error("Scan credit debit failed", debitError); return json({ error: "Could not confirm station scan entitlement. No assessment was saved." }, 503); }
      if (!debitOk) return json({ error: "No scan credits are available." }, 402);
    }
    return json({ result: assessment, model: "gemini-3.1-flash-lite", assessed_at: new Date().toISOString() });
  } catch (error) {
    console.error("gemini-grade failed; request details omitted.");
    return json({ error: "Unable to complete the grading request." }, 500);
  }
});
