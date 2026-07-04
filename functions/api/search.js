// functions/api/search.js
// SPOOR — buscador de Google Fonts en uso (consulta D1)
// Cloudflare Pages Function. Responde a:  GET /api/search?q=<tipografía>
// La base D1 llega por el binding env.DB (variable "DB" -> base spoor-index).

const LIMIT = 50;   // cuántos sitios devolver por búsqueda (top por popularidad)

export async function onRequestGet(context) {
  const { request, env } = context;
  const q = (new URL(request.url).searchParams.get("q") || "").trim();

  if (!q)      return json({ error: "missing_query" }, 400);
  if (!env.DB) return json({ error: "no_db", hint: "Falta el binding DB en Cloudflare" }, 500);

  // Normalización: "Open Sans" -> "opensans" (minúsculas, sin espacios ni signos)
  const slug = normalizar(q);
  if (!slug) return json({ query: q, count: 0, results: [] });

  try {
    const stmt = env.DB
      .prepare("SELECT dominio, rank FROM uso WHERE familia = ? ORDER BY rank ASC LIMIT ?")
      .bind(slug, LIMIT);
    const { results } = await stmt.all();

    const salida = (results || []).map(r => ({
      d:   r.dominio,
      url: "https://" + r.dominio,
      rank: r.rank
    }));

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
