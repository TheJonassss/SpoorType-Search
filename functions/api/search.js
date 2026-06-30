// functions/api/search.js
// SPOOR — mecanismo textual (Serper)
// Cloudflare Pages Function. Responde a:  GET /api/search?q=<tipografía>
// La API key NUNCA va aquí: vive en una variable de entorno (env.SERPER_API_KEY).

import blocklist from "./blocklist.json";

const QUERY_ANCHOR = "typeface";
const MAX_RESULTS  = 10;

const PORTFOLIO_DOMAINS = [
  "behance.net", "dribbble.com", "fontsinuse.com", "are.na",
  "cargo.site", "cargocollective.com", "readymag.com", "format.com", "awwwards.com"
];

export async function onRequestGet(context) {
  const { request, env } = context;
  const q = (new URL(request.url).searchParams.get("q") || "").trim();

  // limpiamos la key de espacios/saltos invisibles que se cuelan al pegar
  const rawKey = env.SERPER_API_KEY || "";
  const key = rawKey.trim();

  if (!q)     return json({ error: "missing_query" }, 400);
  if (!key)   return json({ error: "missing_key", hint: "SERPER_API_KEY no está definida en este entorno" }, 500);

  const exclusions = (blocklist.query_exclusions?.dominios || [])
    .map(d => `-site:${d}`).join(" ");
  const anchor = QUERY_ANCHOR ? ` ${QUERY_ANCHOR}` : "";
  const googleQuery = `"${q}"${anchor} ${exclusions}`.trim();

  let data;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: googleQuery, num: MAX_RESULTS })
    });

    if (res.status === 429) {
      return json({ error: "quota" }, 429);
    }
    if (res.status === 401 || res.status === 403) {
      const detail = await safeText(res);
      // pistas seguras (NO revelan la key): largo y si traía espacios
      return json({
        error: "auth",
        status: res.status,
        detail,
        keyLength: key.length,
        hadWhitespace: rawKey !== key
      }, 502);
    }
    if (!res.ok) {
      const detail = await safeText(res);
      return json({ error: "provider_error", status: res.status, detail }, 502);
    }
    data = await res.json();
  } catch (e) {
    return json({ error: "provider_unreachable" }, 502);
  }

  const blocked = buildBlockSet();
  const allow   = new Set((blocklist.allowlist?.dominios || []).map(s => s.toLowerCase()));

  const seen = new Set();
  const results = [];
  for (const item of (data.organic || [])) {
    if (!item.link) continue;
    const host = hostname(item.link);
    if (!host) continue;
    const bare = host.replace(/^www\./, "").toLowerCase();

    if (!allow.has(bare) && isBlocked(bare, blocked)) continue;

    const dedupKey = bare + "|" + (item.title || "");
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    results.push({
      t:   item.title || bare,
      d:   bare,
      url: item.link,
      o:   isPortfolio(bare) ? "portafolio" : "web",
      s:   item.snippet || ""
    });
  }

  results.sort((a, b) => rank(a) - rank(b));
  return json({ query: q, count: results.length, results });
}

// ── helpers ──────────────────────────────────────────────────────
function buildBlockSet() {
  const pf = blocklist.post_filter || {};
  const domains = [];
  for (const k of Object.keys(pf)) {
    if (!k.startsWith("_") && Array.isArray(pf[k])) domains.push(...pf[k]);
  }
  domains.push(...(blocklist.query_exclusions?.dominios || []));
  domains.push(...(blocklist.foundries?.dominios_seed || []));
  return new Set(domains.map(s => s.toLowerCase()));
}
function isBlocked(bare, blocked) {
  for (const b of blocked) {
    if (bare === b || bare.endsWith("." + b)) return true;
  }
  return false;
}
function isPortfolio(bare) {
  return PORTFOLIO_DOMAINS.some(d => bare === d || bare.endsWith("." + d));
}
function rank(r)        { return r.o === "portafolio" ? 0 : 1; }
function hostname(link) { try { return new URL(link).hostname; } catch { return null; } }
async function safeText(res) { try { return (await res.text()).slice(0, 200); } catch { return ""; } }

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
