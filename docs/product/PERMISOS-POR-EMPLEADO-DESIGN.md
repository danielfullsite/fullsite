# Permisos por empleado — diseño (estilo Square/Toast)

> 2026-08-30 · Daniel eligió la opción potente: el dueño marca ✓ por sección para cada
> persona, y quien no tiene acceso NO ve esa sección ni en su sidebar. Este doc es el
> contrato; se construye en 2 PRs para no romper nada.

## Principio: aditivo y retrocompatible

`canAccessPage(role, path)` sigue siendo la única puerta (sidebar Y rebote de URL ya la
usan). El cambio es que ahora acepta un **override opcional de permisos**; si no hay
override guardado para el usuario, cae EXACTAMENTE al comportamiento por rol de hoy. Nadie
pierde acceso al desplegar: los overrides nacen vacíos y el rol manda hasta que el dueño
personalice.

## Las secciones (unidad de permiso)

No se marca página-por-página (frágil): se marca por **sección funcional**, mapeada a los
grupos que ya existen en roles.ts:

| Sección | Rutas (grupos actuales) |
|---|---|
| `pos` | POS_PAGES |
| `operacion` | /ventas, /meseros, /platillos, /tendencias, /propinas, /reportes, /sucursales |
| `finanzas` | FINANCIAL_PAGES (/estado-resultados, /nomina, /ingresos, /roi, /food-cost, /proveedores) |
| `inventario` | /inventario, /inventario-real, /compras, /recepcion-factura, /merma |
| `agentes` | AGENT_PAGES (/agentes, /coach, /chat) |
| `cortes` | /cortes, /control-efectivo, /conciliacion |
| `admin` | /admin, /configuracion, /equipo |

## PR 1 — Cimiento (tabla + canAccessPage con override)

1. **Migración** `pos_staff_permissions` (aplicar staging→prod con OK de Daniel):
   ```
   client_id text, staff_id text, sections jsonb, updated_at timestamptz
   PRIMARY KEY (client_id, staff_id)
   -- sections: {"finanzas": false, "inventario": true, ...}; ausencia = usar rol
   ```
2. **`SECTIONS` en roles.ts**: el mapa sección→rutas de arriba, más
   `sectionForPath(path)` y `defaultSectionsForRole(role)` (deriva el default desde la
   lógica actual — así el override "vacío" reproduce el rol).
3. **`canAccessPage(role, path, overrides?)`**: si `overrides` trae la sección de `path`,
   manda ese booleano; si no, cae al rol. Firma vieja (`role, path`) sigue válida.
4. **AuthContext** carga los overrides del usuario (una consulta más, cacheada) y los pasa
   al sidebar; el edge/middleware los ignora por ahora (usa rol — más estricto, nunca
   menos). Cero cambios visibles hasta que existan overrides.

## PR 2 — Configuración (la pantalla)

- En **/equipo**, junto a cada empleado, botón "Permisos" → modal con un ✓ por sección
  (precargado con el default de su rol). Guardar → `pos_staff_permissions` vía un endpoint
  `withPOSAuth` gateado a dueño/gerente (nunca del body: tenant de auth.clientId).
- El sidebar ya respeta `canAccessPage` → al guardar, el menú del empleado se recorta solo.
- Regla dura: **el dueño no puede quitarse `admin` a sí mismo** (candado anti-lockout).

## Lo que NO cambia
- Los invariantes de seguridad: el server SIEMPRE valida por rol como piso mínimo; el
  override solo puede RESTRINGIR de más respecto al rol, nunca ELEVAR por encima (un mesero
  con override de finanzas en true igual choca con el gate de rol del endpoint). Los
  overrides son una capa de UX/visibilidad + defensa en profundidad, no la única puerta.
- Multi-tenant: `pos_staff_permissions` lleva `client_id`; se resuelve con el tenant activo
  (post-fix de fugas 2026-08-30).
