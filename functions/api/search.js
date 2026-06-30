// functions/api/search.js
// SPOOR — mecanismo textual (Firecrawl)
// Cloudflare Pages Function. Responde a:  GET /api/search?q=<tipografía>
// La API key NUNCA va aquí: vive en una variable de entorno (env.FIRECRAWL_API_KEY).

import blocklist from "./blocklist.json";

// ── Ajustes ──────────────────────────────────────────────────────
const QUERY_ANCHOR = "typeface";   // "" = nombre tal cual · "typeface" = ancla de contexto
const MAX_RESULTS  = 10;           // resultados por búsqueda (Firecrawl: 2 créditos por cada 10)

const PORTFOLIO_DOMAINS = [
  "behance.net", "dribbble.com", "fontsinuse.com", "are.na",
  "cargo.site", "cargocollective.com", "readymag.com", "format.com", "awwwards.com"
];

export async function onRequestGet(context) {
  const { request, env } = context;
  const q = (new URL(request.url).searchParams.get("q") || "").trim();

  const rawKey = env.FIRECRAWL_API_KEY || "";
  const key = rawKey.trim();

  if (!q)    return json({ error: "missing_query" }, 400);
  if (!key)  return json({ error: "missing_key", hint: "FIRECRAWL_API_KEY no está definida en este entorno" }, 500);

  // ── 1. Construir la query: nombre + ancla + exclusiones -site: ──
  const exclusions = (blocklist.query_exclusions?.dominios || [])
    .map(d => `-site:${d}`).join(" ");
  const anchor = QUERY_ANCHOR ? ` ${QUERY_ANCHOR}` : "";
  const searchQuery = `"${q}"${anchor} ${exclusions}`.trim();

  // ── 2. Llamar a Firecrawl (/v2/search, solo resultados web, sin scraping) ──
  let data;
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: searchQuery, limit: MAX_RESULTS, sources: ["web"] })
    });

    if (res.status === 429) {
      return json({ error: "quota" }, 429);
    }
    if (res.status === 401 || res.status === 403) {
      const detail = await safeText(res);
      return json({
        error: "auth", status: res.status, detail,
        keyLength: key.length, hadWhitespace: rawKey !== key,
        keyStart: key.slice(0, 4), keyEnd: key.slice(-4)
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

  // ── 3. Sacar el arreglo de resultados (parseo defensivo: distintas formas posibles) ──
  const items =
      (data?.data?.web && Array.isArray(data.data.web)) ? data.data.web
    : (data?.web       && Array.isArray(data.web))      ? data.web
    : (data?.data      && Array.isArray(data.data))     ? data.data
    : (Array.isArray(data) ? data : []);

  // ── 4. Normalizar + filtrar (blocklist) + deduplicar ──
  const blocked = buildBlockSet();
  const allow   = new Set((blocklist.allowlist?.dominios || []).map(s => s.toLowerCase()));

  const seen = new Set();
  const results = [];
  for (const item of items) {
    const link = item.url || item.link;
    if (!link) continue;
    const host = hostname(link);
    if (!host) continue;
    const bare = host.replace(/^www\./, "").toLowerCase();

    if (!allow.has(bare) && isBlocked(bare, blocked)) continue;

    const dedupKey = bare + "|" + (item.title || "");
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    results.push({
      t:   item.title || bare,
      d:   bare,
      url: link,
      o:   isPortfolio(bare) ? "portafolio" : "web",
      s:   item.description || item.snippet || ""
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
