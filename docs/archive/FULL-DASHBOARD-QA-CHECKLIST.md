# QA Checklist — Fullsite Dashboard

> Checklist ejecutable derivado de la auditoría funcional del 2026-07-17.
> Cada item es verificable. Marcar [x] cuando se confirme en producción.

---

## P0 — Crítico (verificar ANTES de cualquier demo o instalación)

### Inventario
- [ ] Registrar una entrada en /inventario-real/entradas → verificar que pos_inventory incrementa stock
- [ ] Registrar merma en /inventario-real/merma → verificar que pos_inventory decrementa stock
- [ ] Hacer toma física → verificar que diferencias ajustan pos_inventory
- [ ] Auto-86 muestra items correctos cuando stock llega a 0

### Seguridad multi-tenant
- [ ] `/api/chat` — enviar `client_id: "otro_tenant"` en body → NO debe devolver datos de otro tenant
- [ ] `x-client-id: otro_tenant` header en cualquier API → NO debe devolver datos de otro tenant
- [ ] `/contabilidad` — verificar que pos_orders query incluye `client_id` filter
- [ ] `/reporte-fiscal` — verificar que pos_cfdi_requests query incluye `client_id` filter
- [ ] `/api/backup` — verificar que exporta solo datos del tenant activo

### Datos
- [ ] `/caja` tabla diaria — verificar que montos coinciden con el gráfico (no porcentajes como pesos)
- [ ] Ventas anti-fraude — cambiar preset a "semana pasada" → verificar que cancelaciones corresponden a esa semana

---

## P1 — Bloqueador (verificar antes de segundo restaurante)

### APIs
- [ ] `POST /api/pos/save-order` sin Authorization header → debe devolver 401
- [ ] `POST /api/pos/merge-orders` sin Authorization header → debe devolver 401
- [ ] `POST /api/pos/pin` con `client_id: "otro"` en body → NO debe validar PINs de otro tenant
- [ ] `/api/backup` — env var `SUPABASE_SERVICE_KEY` configurada en Vercel (no `SERVICE_ROLE_KEY`)

### POS
- [ ] Mesero intenta ver Corte X → debe ser bloqueado por role
- [ ] Gerente desbloquea corte → otro usuario en misma terminal NO debe tener acceso después de lock
- [ ] Mesero intenta fusionar mesas → debe requerir PIN de gerente
- [ ] Editar tarifa en nómina → refrescar página → tarifa debe persistir

### Datos
- [ ] Identificar cuál es la tabla canónica de stock: pos_inventory o pos_inventory_products
- [ ] Verificar que auto86 lee de la misma tabla que entradas/merma escriben
- [ ] Verificar freshness de wansoft inventory_parsed (< 24h)

### Error handling
- [ ] Desconectar internet → abrir /cancelaciones → NO debe quedar en spinner infinito
- [ ] Desconectar internet → abrir /delivery → NO debe quedar en spinner infinito
- [ ] Desconectar internet → abrir cualquier página de reportes → debe mostrar mensaje de error

---

## P2 — Importante (verificar antes de venta formal)

### Seguridad
- [ ] `/pos/auditoria` — verificar que mesero NO puede acceder por URL directo
- [ ] `/pos/historial` — verificar que mesero solo ve SUS órdenes, no de todos
- [ ] `/admin/menu` — verificar que mesero NO puede acceder por URL directo
- [ ] Writes en /gastos, /control-efectivo, /notas-credito usan service_role (no anon)
- [ ] `monica@fullsite.mx` removida de backup admins
- [ ] Sesión `fs-at` cookie es httpOnly

### Consistencia
- [ ] Crear gasto en /gastos → verificar que aparece en /egresos (o documentar que son separados)
- [ ] Editar receta en /recetas → verificar que /food-cost refleja el cambio
- [ ] Agregar proveedor en /proveedores → verificar que aparece en /inventario-real/entradas dropdown
- [ ] Movimientos muestra nombre de proveedor (no [object Object])

### Formularios
- [ ] /admin/menu — intentar guardar precio negativo → debe ser rechazado
- [ ] /admin/formas-pago — intentar guardar comisión negativa → debe ser rechazado
- [ ] /inventario-real/reorden — guardar max < min → debe ser rechazado
- [ ] /notas-credito — crear 2 notas simultáneamente → folios deben ser únicos
- [ ] Double-click en cualquier botón de guardado → no debe crear duplicados

### UX
- [ ] Todos los reportes tienen botón de export (CSV o Excel)
- [ ] Tablas con >100 rows tienen paginación o virtual scroll
- [ ] Estados vacíos en TODAS las páginas (no solo $0)
- [ ] Loading states en TODAS las páginas
- [ ] Error states en TODAS las páginas (no solo spinner infinito)

---

## P3 — Mejora (verificar cuando haya tiempo)

- [ ] Sidebar muestra indicador real de conectividad
- [ ] NotificationBell visible en mobile
- [ ] Charts tienen leyendas en todas las páginas
- [ ] Date pickers accesibles por teclado
- [ ] confirm() reemplazado por modales en Electron
- [ ] Admin/usuarios: password field funcional o removido
