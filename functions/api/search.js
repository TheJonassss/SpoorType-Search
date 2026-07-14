// functions/api/search.js
// SPOOR — buscador de Google Fonts en uso (consulta D1)
// Cloudflare Pages Function. Responde a:  GET /api/search?q=<tipografía>
// La base D1 llega por el binding env.DB (variable "DB" -> base spoor-index).

const LIMIT = 50;   // cuántos sitios devolver por búsqueda (top por popularidad)

// Dominios adultos explícitos que se excluyen de los resultados.
// Atrapa a los grandes conocidos; no es exhaustivo (ver README/notas).
const BLOCKED = new Set([
  "pornhub.com","xvideos.com","xnxx.com","xhamster.com","redtube.com","youporn.com",
  "tube8.com","spankbang.com","chaturbate.com","stripchat.com","bongacams.com",
  "livejasmin.com","cam4.com","myfreecams.com","motherless.com","thisvid.com",
  "iporntv.net","porntrex.com","eporner.com","txxx.com","hclips.com","upornia.com",
  "hqporner.com","porn.com","brazzers.com","fapello.com","erome.com","xpaja.net",
  "youjizz.com","porn300.com","porndish.com","pornhd.com","hentaihaven.xxx",
  "nhentai.net","rule34.xxx","e-hentai.org","fapello.is","porngo.com","4tube.com",
  "drtuber.com","nuvid.com","sunporno.com","porntube.com","tnaflix.com","empflix.com",
  "onlyfans.com","fansly.com","adultfriendfinder.com","xvideos2.com","xnxx-cdn.com"
]);

// TLDs que son inequívocamente adultos
const BLOCKED_TLD = [".xxx", ".adult", ".porn", ".sex"];

function isBlocked(dom) {
  const d = dom.toLowerCase();
  for (const tld of BLOCKED_TLD) { if (d.endsWith(tld)) return true; }
  return BLOCKED.has(d);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const q = (new URL(request.url).searchParams.get("q") || "").trim();

  if (!q)      return json({ error: "missing_query" }, 400);
  if (!env.DB) return json({ error: "no_db", hint: "Falta el binding DB en Cloudflare" }, 500);

  // Normalización: "Open Sans" -> "opensans" (minúsculas, sin espacios ni signos)
  const slug = normalizar(q);
  if (!slug) return json({ query: q, count: 0, results: [] });

  try {
    // traemos todos los disponibles (máx 100 por familia) para compensar el filtrado
    const stmt = env.DB
      .prepare("SELECT dominio, rank FROM uso WHERE familia = ? ORDER BY rank ASC LIMIT 100")
      .bind(slug);
    const { results } = await stmt.all();

    const salida = (results || [])
      .filter(r => !isBlocked(r.dominio))   // fuera dominios adultos explícitos
      .slice(0, LIMIT)                      // top 50 ya limpios
      .map(r => ({ d: r.dominio, url: "https://" + r.dominio, rank: r.rank }));

    return json({ query: q, slug, count: salida.length, results: salida });
  } catch (e) {
    return json({ error: "db_error", detail: String(e).slice(0, 200) }, 502);
  }
}

// "Playfair Display" -> "playfairdisplay" · quita todo lo que no sea letra/número
function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[^a-z0-9]/g, "");                        // deja solo a-z 0-9
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
