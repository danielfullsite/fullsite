# 05 — Propuesta de Contrato del MigrationConnector

> Fase 0 del Fullsite Migration Engine  
> Fecha: 2026-07-27  
> Scope: Interfaces TypeScript conceptuales — NO son código de producción.  
> Propósito: definir el contrato que todo conector debe cumplir para ser intercambiable.

---

## 1. Interfaz principal

```typescript
/**
 * MigrationConnector — Contrato base para todos los conectores de migración.
 *
 * Principio: el conector EXTRAE y MAPEA. El core VALIDA, TRANSFORMA y ESCRIBE.
 * Un conector nunca escribe a ninguna tabla productiva directamente.
 */
interface MigrationConnector {
  /** Metadatos del conector: versión, POS soportado, entidades disponibles. */
  metadata(): ConnectorMetadata

  /**
   * Verifica que la conexión con el sistema origen es posible.
   * Debe ser seguro de llamar en cualquier momento sin efectos secundarios.
   */
  testConnection(): Promise<ConnectionResult>

  /**
   * Descubre qué entidades están disponibles en este sistema origen.
   * Útil para mostrar al usuario qué puede importar antes de correr la migración.
   */
  discover(): Promise<EntityCatalog>

  /**
   * Extrae registros crudos de una entidad del sistema origen.
   * Devuelve un AsyncIterable para manejar volúmenes grandes sin cargar todo en memoria.
   * El conector NO valida ni transforma — solo extrae.
   */
  extract(entity: string, options: ExtractOptions): AsyncIterable<RawRecord>

  /**
   * Mapea un registro crudo del sistema origen al modelo canónico de Fullsite.
   * Puro: no tiene efectos secundarios, no llama APIs, no escribe a BD.
   * Si no puede mapear: devuelve null (el core decide qué hacer con los nulos).
   */
  mapToCanonical(entity: string, raw: RawRecord): CanonicalRecord | null

  /**
   * Valida un lote de registros crudos ANTES de que el core los procese.
   * Útil para detección temprana de problemas estructurales en el origen.
   * No bloquea la migración — reporta para que el humano decida.
   */
  validateSource(entity: string, records: RawRecord[]): ValidationReport
}
```

---

## 2. Tipos de soporte

```typescript
interface ConnectorMetadata {
  /** Identificador único del conector: 'wansoft', 'csv', 'softrestaurant' */
  id: string
  
  /** Nombre legible: 'Wansoft POS', 'CSV/Excel Import' */
  name: string
  
  /** Versión semántica del conector */
  version: string
  
  /** Entidades que este conector puede extraer */
  supported_entities: string[]
  
  /** Si requiere credenciales activas del sistema origen */
  requires_live_connection: boolean
  
  /** URL base del sistema origen (null para CSV) */
  base_url: string | null
  
  /** Descripción para mostrar al usuario en UI */
  description: string
  
  /** Advertencias importantes sobre limitaciones del conector */
  caveats: string[]
}


interface ConnectionResult {
  success: boolean
  message: string
  latency_ms: number | null
  
  /** Detalles de error si success=false */
  error_code: string | null
  error_detail: string | null
  
  /** Metadata adicional del sistema origen (versión, sucursal detectada) */
  meta: Record<string, unknown>
}


interface EntityCatalog {
  /** Timestamp de cuando se ejecutó el discover */
  discovered_at: string
  
  entities: EntityInfo[]
}

interface EntityInfo {
  /** Nombre de la entidad: 'products', 'recipes', 'suppliers' */
  entity: string
  
  /** Etiqueta legible: 'Platillos', 'Recetas', 'Proveedores' */
  label: string
  
  /** Estimado de records (puede ser aproximado) */
  estimated_count: number | null
  
  /** Si esta entidad puede extraerse con el estado actual de la conexión */
  available: boolean
  
  /** Razón por la que no está disponible (null si available=true) */
  unavailable_reason: string | null
  
  /** Dependencias: entidades que deben extraerse antes que esta */
  depends_on: string[]
}


interface ExtractOptions {
  /** Si se provee, reanudar desde este checkpoint */
  checkpoint: ExtractionCheckpoint | null
  
  /** Número máximo de records a extraer (null = todos) */
  limit: number | null
  
  /** Filtros específicos del conector (ej: fecha para ventas diarias) */
  filters: Record<string, unknown>
  
  /** Si true: solo contar records, no extraer contenido */
  count_only: boolean
  
  /** ID de la sesión de migración (para trazabilidad) */
  session_id: string
}


/**
 * Checkpoint — permite reanudar una extracción interrumpida.
 * El conector decide qué información necesita para reanudar (cursor, offset, fecha, etc.)
 */
interface ExtractionCheckpoint {
  entity: string
  session_id: string
  created_at: string
  
  /** Cursor opaco del conector. Para Wansoft: offset numérico. Para fecha: ISO string. */
  cursor: unknown
  
  records_extracted: number
}


/**
 * RawRecord — registro tal como viene del sistema origen.
 * El conector no transforma nada. El core es el único que sabe qué hacer con esto.
 */
interface RawRecord {
  /** ID único en el sistema origen (ej: 'ABA002' para un ingrediente Wansoft) */
  source_id: string
  
  /** Hash SHA-256 del raw_data — para detectar cambios sin comparar campo por campo */
  source_hash: string
  
  /** Datos tal como vienen del origen, sin modificar */
  raw_data: Record<string, unknown>
  
  /** Timestamp UTC de extracción */
  extracted_at: string
  
  /** Número de intento (para reintentos) */
  attempt: number
}


/**
 * CanonicalRecord — registro mapeado al modelo canónico de Fullsite.
 * Si el mapeo no es posible, mapToCanonical debe devolver null, no lanzar excepción.
 */
interface CanonicalRecord {
  entity: string
  
  /** El registro en el formato del modelo canónico (ver 04-canonical-model-proposal.md) */
  data: Record<string, unknown>
  
  /** El RawRecord original que produjo este registro canónico */
  source: RawRecord
  
  /** Advertencias generadas durante el mapeo (no bloquean, son informativas) */
  mapping_warnings: string[]
}


interface ValidationReport {
  entity: string
  total_records: number
  
  /** Records que pasaron todas las validaciones */
  valid: number
  
  /** Records con errores que impiden el procesamiento */
  invalid: number
  
  /** Records con warnings (se procesan pero requieren revisión) */
  with_warnings: number
  
  issues: ValidationIssue[]
  
  /** Categorías desconocidas encontradas → necesitan ser agregadas al CATEGORY_MAP */
  unmapped_categories: string[]
  
  /** Unidades desconocidas → necesitan ser agregadas al UNIT_MAP */
  unmapped_units: string[]
  
  /** IDs referenciados que no existen en el catálogo */
  orphan_references: string[]
  
  /** Pares de registros duplicados detectados */
  duplicates: { exact: number; fuzzy: number }
}

interface ValidationIssue {
  severity: 'error' | 'warning' | 'info'
  record_id: string
  field: string
  message: string
  value?: unknown
}
```

---

## 3. Responsabilidades del conector vs. el core

### El conector es responsable de:
- Autenticarse con el sistema origen
- Navegar la estructura del portal/API/archivo
- Extraer records crudos sin modificar su contenido
- Mapear campos del origen al modelo canónico (mapeo 1:1, sin lógica de negocio)
- Reportar qué entidades están disponibles
- Mantener/restaurar checkpoints de extracción
- Guardar el `source_hash` de cada record extraído
- Reportar entidades no soportadas con razón clara

### El core es responsable de:
- Recibir records del conector y decidir qué hacer con ellos
- Ejecutar validaciones (el conector puede pre-validar, pero el core siempre valida)
- Resolver orphan references entre entidades
- Aplicar mapas de normalización (categorías, unidades)
- Detectar duplicados cross-entidad
- Escribir a las tablas de destino
- Ejecutar rollbacks
- Loguear en `migration_sessions` y `agent_runs`
- Notificar resultados al usuario

### Lo que un conector NUNCA puede hacer:
- Escribir directamente a ninguna tabla productiva (`pos_*`, `wansoft_*`)
- Saltar el paso de validación del core
- Modificar el `raw_data` antes de entregarlo al core
- Hacer decisiones de mapeo que dependan de datos de otros conectores
- Enviar notificaciones o mensajes a Telegram/Slack
- Leer credenciales directamente del entorno (las recibe del core vía constructor)
- Ejecutar DDL (CREATE, ALTER, DROP)

---

## 4. Manejo de checkpoints

Un checkpoint permite reanudar una extracción interrumpida sin re-extraer todo desde el inicio.

**Flujo:**
```
[core inicia migración] → [asigna session_id] → [connector.extract(entity, {checkpoint: null})]
    → [records fluyen al core]
    → [core guarda checkpoint periódicamente] → [migration_sessions.checkpoint = cursor]
    → [si falla: core puede llamar connector.extract(entity, {checkpoint: last_saved})]
    → [conector reanuda desde cursor]
```

**Contrato del conector:**
- El cursor es opaco para el core (puede ser offset numérico, fecha, token de paginación)
- El conector debe garantizar que records ya procesados no se repitan al reanudar
- Si el checkpoint es inválido o expiró: lanzar `CheckpointExpiredError` para que el core decida reiniciar

**Implementación para Wansoft:**
- Para entidades paginadas: cursor = `{ offset: 500, page: 2 }`
- Para ventas diarias: cursor = `{ last_date: '2026-01-15' }`
- Para catálogo: cursor = `{ last_code: 'PRO027' }` (ordenado por código)

---

## 5. Preservación de registros raw

Todo record extraído debe guardarse en una tabla de archivo antes de ser procesado:

```typescript
// Tabla sugerida: migration_raw_records
// Se crea por sesión, se archiva después de N días.
interface MigrationRawRecord {
  id: string                    // uuid
  session_id: string            // FK → migration_sessions
  entity: string                // 'products', 'suppliers', etc.
  source_id: string             // ID en el sistema origen
  source_hash: string           // para detectar cambios
  raw_data: Record<string,unknown>  // JSONB
  connector_id: string          // 'wansoft', 'csv', etc.
  extracted_at: string
  
  // Estado después del procesamiento:
  status: 'pending' | 'processed' | 'rejected' | 'skipped'
  rejection_reason: string | null
}
```

Esto permite:
- Rollback: delete canónico + re-procesar desde raw si necesario
- Auditoría: ver exactamente qué recibimos del origen
- Debugging: comparar raw vs canónico para encontrar bugs en el mapper

---

## 6. Reporte de entidades no soportadas

Si una entidad solicitada no está en `metadata().supported_entities`, el conector debe:

```typescript
// Al llamar connector.extract('promotions', options) en un conector que no las soporta:
// NO lanzar excepción (rompe el flujo de migración)
// En cambio: devolver un AsyncIterable vacío + loguear en ValidationReport

interface UnsupportedEntityReport {
  entity: string
  connector_id: string
  reason: 'not_implemented' | 'no_api_access' | 'data_not_available'
  message: string
  
  /** Si parcialmente soportada: qué campos sí están disponibles */
  partial_fields: string[]
  
  /** Sugerencia de cómo obtener esta entidad */
  workaround: string | null
}
```

El core recibe este reporte y decide si la entidad faltante es bloqueante o no.

---

## 7. Evaluación de segundo conector de prueba

### Opción A — Generic CSV/Excel

| Criterio | Evaluación |
|---|---|
| Esfuerzo | 2/5 (bajo) — leer CSV/XLSX es trivial con npm packages |
| Valor | 4/5 — muchos restaurantes tienen sus datos en Excel (menú, recetas, proveedores) |
| Riesgos | Schema variable: cada restaurante formatea diferente. Requiere template o mapping UI. |
| Acceso externo requerido | No — es un archivo local |
| Utilidad para onboarding | Alta — permite onboardear sin integración con POS |

### Opción B — Fixture simulado de otro POS

| Criterio | Evaluación |
|---|---|
| Esfuerzo | 1/5 (mínimo) — es un connector que lee un JSON estático |
| Valor | 3/5 — útil para testing pero no para producción real |
| Riesgos | No representa un POS real, puede crear expectativas falsas |
| Acceso externo requerido | No |
| Utilidad para onboarding | Media — sirve para CI/tests pero no para demos con clientes |

### Opción C — Soft Restaurant

| Criterio | Evaluación |
|---|---|
| Esfuerzo | 4/5 (alto) — requiere reverse engineering similar a Wansoft |
| Valor | 5/5 — Soft Restaurant es el #2 de México (y mercado objetivo de Fullsite) |
| Riesgos | Acceso requiere cuenta activa o backup de cliente. Sin evidencia en el repo de que se contempló. |
| Acceso externo requerido | Sí — portal Soft Restaurant o backup SQL |
| Utilidad para onboarding | Muy alta — desbloquea un segmento de mercado distinto |

### Recomendación: Opción A (CSV/Excel)

**Justificación:** El CSV connector tiene el esfuerzo más bajo y el valor más alto para el onboarding inmediato. Muchos prospectos (como Atope, que tiene 3 sucursales) pueden exportar su menú y recetas a Excel desde cualquier POS. Permite demostrar el Migration Engine sin dependencia de APIs externas ni acceso a sistemas activos.

El orden natural de implementación sería: Wansoft connector (ya 80% existe) → CSV connector → Soft Restaurant connector (cuando haya un cliente en ese POS).
