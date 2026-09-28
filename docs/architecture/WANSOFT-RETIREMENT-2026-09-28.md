# Retiro de adquisición Wansoft — 2026-09-28

## Decisión

Fullsite deja de usar Wansoft como fuente operativa o de inteligencia. La
operación y el dashboard deben preferir datos canónicos de Fullsite. Esta
retirada elimina los workflows de scraping/consulta del árbol activo y hace
que los scripts legacy fallen cerrados antes de obtener credenciales, cookies
o abrir una conexión a Wansoft.

## Alcance de este cambio

- Se retiran los workflows Wansoft de scraping, consultas, probes, auditorías,
  sincronizaciones, backfills y cron de intradía/ticket detail.
- Los scripts legacy fallan cerrados antes de devolver credenciales, cargar o
  almacenar cookies y contactar Wansoft. No existe una variable de entorno
  que los reactive: una excepción futura requeriría un cambio revisado.
- Se conserva la importación manual de un extracto ya obtenido y sus pruebas:
  no se conecta a Wansoft y permite preservar histórico bajo una autorización
  separada.

Los workflows retirados son: `wansoft-backfill`, `wansoft-browser`,
`wansoft-daily-mesero`, `wansoft-data-audit`, `wansoft-deep`,
`wansoft-discovery`, `wansoft-export-discovery`, `wansoft-inv-scrape`,
`wansoft-inventory`, `wansoft-mega`, `wansoft-menu-sync`, `wansoft-probe`,
`wansoft-query`, `wansoft-recipes`, `wansoft-sales-probe`,
`wansoft-staleness`, `wansoft-subproducts`, `ticket-detail`,
`intraday-sales` y `menu-gap-analysis`.

## No incluido

- No se borran tablas ni datos históricos `wansoft_*`.
- No se cambian secretos, perfiles, Supabase, producción ni migraciones.
- No se afirma que todas las superficies del dashboard hayan dejado de leer
  histórico Wansoft; esa migración se entrega de forma independiente por la
  rama de dashboard.

## Rollback

Revertir este commit restaura los workflows y el guard. No restaurar ni rotar
credenciales como parte de un rollback. Cualquier acceso externo posterior
requiere su propio cambio revisado y autorización explícita.
