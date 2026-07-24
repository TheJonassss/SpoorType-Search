// functions/api/stats.js
// SPOOR — cifras del índice para el pie de la home.
// Lee la tabla `meta` (3 filas), NO cuenta sobre `uso` (eso leería 142k filas por visita).
// La tabla `meta` se recalcula una vez al mes, durante el refresco (ver REFRESH.md).

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return json({ error: "no_db" }, 500);

  try {
    const { results } = await env.DB
      .prepare("SELECT clave, valor FROM meta")
      .all();

    const m = {};
    for (const r of (results || [])) m[r.clave] = r.valor;

    return json({
      familias: m.familias || null,
      dominios: m.dominios || null,
      crawl:    m.crawl    || null
    });
  } catch (e) {
    return json({ error: "db_error" }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      // cambia una vez al mes: se puede cachear con holgura
      "Cache-Control": "public, max-age=86400"
    }
  });
}
