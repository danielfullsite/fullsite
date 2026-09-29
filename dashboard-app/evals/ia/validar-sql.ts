// ── Espejo en TypeScript de ia._validar_sql (la primera capa de ia_consulta) ─────
//
// Fuente: supabase/migrations/*_ia_lectura_universal.sql → ia._validar_sql. Sirve a las
// pruebas (y al generador como autochequeo) para saber, SIN red, si una consulta de la
// eval pasaría el filtro de texto de la base. Si cambias la lista blanca en la migración,
// cámbiala aquí también (la prueba del generador falla si una plantilla usa algo que ya no
// está permitido).
//
// Traducción de las expresiones de Postgres: `\m` / `\M` (inicio/fin de palabra) → `\b`;
// `~*` → bandera `i`.

export const FUNCIONES_PERMITIDAS: ReadonlySet<string> = new Set([
  'select', 'from', 'where', 'in', 'exists', 'any', 'all', 'some', 'values', 'over', 'filter', 'and', 'or', 'not', 'as', 'on',
  'using', 'when', 'then', 'else', 'case', 'join', 'lateral', 'by', 'having', 'group', 'distinct', 'between', 'like', 'ilike',
  'is', 'union', 'intersect', 'except', 'limit', 'offset', 'with', 'array', 'row', 'partition', 'within',
  'numeric', 'decimal', 'varchar', 'char', 'timestamp', 'timestamptz', 'time', 'date', 'interval', 'int', 'integer', 'bigint', 'text', 'boolean', 'float', 'real',
  'count', 'sum', 'avg', 'min', 'max', 'round', 'floor', 'ceil', 'ceiling', 'abs', 'coalesce', 'nullif', 'greatest', 'least',
  'date_trunc', 'extract', 'date_part', 'to_char', 'to_date', 'to_number', 'now', 'lower', 'upper', 'trim', 'btrim', 'ltrim', 'rtrim',
  'length', 'substring', 'substr', 'replace', 'concat', 'concat_ws', 'split_part', 'position', 'left', 'right', 'initcap',
  'regexp_replace', 'jsonb_array_elements', 'jsonb_array_elements_text', 'jsonb_each', 'jsonb_each_text',
  'jsonb_array_length', 'jsonb_typeof', 'jsonb_build_object', 'jsonb_agg', 'json_agg', 'string_agg', 'array_agg',
  'row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value', 'percentile_cont',
  'percentile_disc', 'mode', 'stddev', 'stddev_pop', 'stddev_samp', 'variance', 'bool_or', 'bool_and', 'every',
  'generate_series', 'cast', 'timezone', 'make_date', 'make_interval', 'age', 'trunc', 'sign', 'mod', 'power', 'sqrt',
  'exp', 'ln', 'es_venta', 'unnest', 'cardinality', 'array_length', 'isfinite', 'justify_interval', 'date_bin',
])

const RE_PROHIBIDO = new RegExp(
  '(pg_|information_schema|\\b(public|ia|auth|storage|extensions|vault|realtime|graphql|net|cron|supabase_\\w*)\\s*\\.|set_config|current_setting|dblink|\\blo_|\\bcopy\\b|\\binto\\b|for\\s+(update|share|no\\s+key|key)|'
  + '\\bcreate\\b|\\binsert\\b|\\bupdate\\b|\\bdelete\\b|\\bdrop\\b|\\balter\\b|\\btruncate\\b|\\bgrant\\b|\\brevoke\\b|\\bcall\\b|\\bdo\\b|\\bexecute\\b|\\blisten\\b|'
  + '\\bnotify\\b|\\bvacuum\\b|\\banalyze\\b|\\breindex\\b|\\bcluster\\b|\\block\\b|\\brefresh\\b|\\bimport\\b|\\bsecurity\\b|\\brecursive\\b)',
  'i',
)

/** null = pasaría ia._validar_sql; si no, el motivo (el mismo texto que da la base). */
export function validarSqlIa(sql: string): string | null {
  let s = (sql ?? '').trim()
  if (!s) return 'consulta vacía'
  s = s.replace(/;\s*$/, '')
  if (s.length > 4000) return 'consulta demasiado larga'
  if (!/^(select|with)\s/i.test(s)) return 'sólo se permiten consultas SELECT'
  if (/(;|--|\/\*|\$|")/.test(s)) return 'caracteres no permitidos en la consulta'
  const sinTexto = s.replace(/'([^']|'')*'/g, "''")
  if (RE_PROHIBIDO.test(sinTexto)) return 'la consulta usa algo no permitido'
  for (const m of sinTexto.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const f = m[1].toLowerCase()
    if (!FUNCIONES_PERMITIDAS.has(f)) return `función no permitida: ${f}`
  }
  return null
}
