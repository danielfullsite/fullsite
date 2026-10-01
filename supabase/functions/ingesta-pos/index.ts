// ingesta-pos — recibe datos de un lector local (por ejemplo, una caja Wansoft)
// y los guarda en las tablas históricas de Fullsite.
//
// Fuente inicial: función activa de producción revisada el 2026-10-01. Este archivo
// se incorpora para que cualquier cambio posterior pueda revisarse y probarse desde Git.
// No despliega ni modifica la función activa por sí solo.
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_BODY = 6 * 1024 * 1024;
const MAX_FILAS = 2000;

type Tipo = "int" | "num" | "text" | "bool" | "date" | "ts";
const ESQUEMA: Record<string, { llave: string; cols: Record<string, Tipo>; req: string[] }> = {
  tickets: {
    llave: "client_id,fuente,ticket_id",
    req: ["ticket_id", "fecha"],
    cols: {
      ticket_id: "int", orden: "int", fecha: "date", abierto_local: "ts", cerrado_local: "ts",
      total: "num", subtotal: "num", descuento: "num", iva: "num", servicio: "num", personas: "int",
      mesa: "text", mesero_id: "int", mesero: "text", estado: "int", tipo_venta: "int",
      cancelado: "bool", cancelado_local: "ts",
    },
  },
  items: {
    llave: "client_id,fuente,renglon_id",
    req: ["renglon_id", "ticket_id"],
    cols: {
      renglon_id: "int", ticket_id: "int", platillo_id: "int", platillo: "text", grupo: "text",
      cantidad: "num", precio_unitario: "num", subtotal: "num", descuento: "num", cortesia: "bool",
      es_modificador: "bool", hora_local: "ts", mesero_id: "int",
    },
  },
  pagos: {
    llave: "client_id,fuente,pago_id",
    req: ["pago_id", "ticket_id"],
    cols: {
      pago_id: "int", ticket_id: "int", forma_pago: "text", monto: "num", propina: "num",
      es_cortesia: "bool", registrado_local: "ts",
    },
  },
};
const TABLA: Record<string, string> = {
  tickets: "historico_tickets", items: "historico_ticket_items", pagos: "historico_pagos",
};

const TABLA_OK = /^[A-Za-z0-9_]{1,80}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$/;

function limpiar(v: unknown, t: Tipo): unknown {
  if (v === null || v === undefined || v === "") return null;
  switch (t) {
    case "int": {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || Math.abs(n) > 9e15) throw new Error("entero inválido");
      return Math.trunc(n);
    }
    case "num": {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new Error("número inválido");
      return n;
    }
    case "text": return String(v).slice(0, 300);
    case "bool": return v === true || v === 1 || v === "1" || v === "true";
    case "date": {
      const s = String(v).slice(0, 10);
      if (!FECHA.test(s)) throw new Error("fecha inválida");
      return s;
    }
    case "ts": {
      const s = String(v);
      if (!TS.test(s)) throw new Error("hora inválida");
      return s.replace(" ", "T");
    }
  }
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "sólo POST" });
  const token = req.headers.get("x-dispositivo-token") ?? "";
  if (token.length < 32 || token.length > 200) return json(401, { error: "no autorizado" });

  const largo = Number(req.headers.get("content-length") ?? "0");
  if (largo > MAX_BODY) return json(413, { error: "cuerpo muy grande" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data: disp } = await sb.from("ingesta_dispositivos")
    .select("id, client_id, fuente, activo")
    .eq("token_hash", await sha256(token)).maybeSingle();
  if (!disp || !disp.activo) return json(401, { error: "no autorizado" });

  const version = (req.headers.get("x-lector-version") ?? "").slice(0, 40) || null;
  const texto = await req.text();
  if (texto.length > MAX_BODY) return json(413, { error: "cuerpo muy grande" });

  let cuerpo: Record<string, unknown>;
  try { cuerpo = texto ? JSON.parse(texto) : {}; }
  catch { return json(400, { error: "JSON inválido" }); }

  const guardados: Record<string, number> = {};
  try {
    for (const clave of Object.keys(ESQUEMA)) {
      const filas = cuerpo[clave];
      if (filas === undefined) continue;
      if (!Array.isArray(filas)) throw new Error(`${clave} debe ser lista`);
      if (filas.length > MAX_FILAS) throw new Error(`${clave}: máximo ${MAX_FILAS} por envío`);
      const { cols, req: requeridas, llave } = ESQUEMA[clave];
      const limpias = filas.map((f, i) => {
        if (typeof f !== "object" || f === null) throw new Error(`${clave}[${i}] inválida`);
        const r: Record<string, unknown> = { client_id: disp.client_id, fuente: disp.fuente };
        for (const [c, t] of Object.entries(cols)) {
          if (c in (f as Record<string, unknown>)) {
            try { r[c] = limpiar((f as Record<string, unknown>)[c], t); }
            catch (e) { throw new Error(`${clave}[${i}].${c}: ${(e as Error).message}`); }
          }
        }
        for (const c of requeridas) if (r[c] === null || r[c] === undefined) throw new Error(`${clave}[${i}] sin ${c}`);
        return r;
      });
      if (limpias.length) {
        const { error } = await sb.from(TABLA[clave]).upsert(limpias, { onConflict: llave });
        if (error) throw new Error(`${clave}: ${error.code ?? "error"} al guardar`);
      }
      guardados[clave] = limpias.length;
    }
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await sb.from("ingesta_dispositivos")
      .update({ ultimo_latido: new Date().toISOString(), ultimo_error: msg, version_lector: version })
      .eq("id", disp.id);
    return json(400, { error: msg });
  }

  try {
    const esp = cuerpo.espejo as { tabla?: unknown; filas?: unknown } | undefined;
    if (esp !== undefined) {
      const tabla = String(esp?.tabla ?? "");
      if (!TABLA_OK.test(tabla)) throw new Error("espejo: tabla inválida");
      if (!Array.isArray(esp.filas) || esp.filas.length > MAX_FILAS) throw new Error(`espejo: filas debe ser lista de máx. ${MAX_FILAS}`);
      const vistas = new Map<string, Record<string, unknown>>();
      (esp.filas as unknown[]).forEach((f, i) => {
        const r = f as { llave?: unknown; datos?: unknown };
        const llave = String(r?.llave ?? "");
        if (!llave || llave.length > 300) throw new Error(`espejo[${i}]: llave inválida`);
        if (typeof r.datos !== "object" || r.datos === null || Array.isArray(r.datos)) throw new Error(`espejo[${i}]: datos inválidos`);
        vistas.set(llave, {
          client_id: disp.client_id, fuente: disp.fuente, tabla, llave, datos: r.datos,
          actualizado_en: new Date().toISOString(),
        });
      });
      const filas = [...vistas.values()];
      if (filas.length) {
        const { error } = await sb.from("pos_espejo")
          .upsert(filas, { onConflict: "client_id,fuente,tabla,llave" });
        if (error) throw new Error(`espejo: ${error.code ?? "error"} al guardar`);
      }
      guardados.espejo = filas.length;
    }
    const cat = cuerpo.espejo_tablas;
    if (cat !== undefined) {
      if (!Array.isArray(cat) || cat.length > 300) throw new Error("espejo_tablas inválido");
      const filas = cat.map((c, i) => {
        const r = c as Record<string, unknown>;
        const tabla = String(r?.tabla ?? "");
        if (!TABLA_OK.test(tabla)) throw new Error(`espejo_tablas[${i}]: tabla inválida`);
        return {
          client_id: disp.client_id, fuente: disp.fuente, tabla,
          estrategia: String(r.estrategia ?? "").slice(0, 40),
          columnas: Array.isArray(r.columnas) ? r.columnas.slice(0, 400) : [],
          filas_origen: Number.isFinite(Number(r.filas_origen)) ? Math.trunc(Number(r.filas_origen)) : null,
          ultima_sync: new Date().toISOString(),
        };
      });
      if (filas.length) {
        const { error } = await sb.from("pos_espejo_tablas")
          .upsert(filas, { onConflict: "client_id,fuente,tabla" });
        if (error) throw new Error(`espejo_tablas: ${error.code ?? "error"} al guardar`);
      }
      guardados.espejo_tablas = filas.length;
    }
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await sb.from("ingesta_dispositivos")
      .update({ ultimo_latido: new Date().toISOString(), ultimo_error: msg, version_lector: version })
      .eq("id", disp.id);
    return json(400, { error: msg });
  }

  const total = Object.values(guardados).reduce((a, b) => a + b, 0);
  const ahora = new Date().toISOString();
  await sb.from("ingesta_dispositivos").update({
    ultimo_latido: ahora, ...(total ? { ultimo_envio: ahora } : {}),
    ultimo_error: null, version_lector: version,
  }).eq("id", disp.id);
  return json(200, { ok: true, guardados });
});
