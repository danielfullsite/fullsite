# WAR ROOM — Martes 8 julio 2026

> Un solo documento para operar el martes.
> No es documentacion. Es un manual de combate.

---

## DRESS REHEARSAL — Flujo E2E

| # | Paso | Resultado esperado | Qué revisar si falla |
|---|------|-------------------|---------------------|
| 1 | Abrir turno con fondo | Modal en /pos/turno, fondo guardado en pos_turnos | Supabase: SELECT * FROM pos_turnos WHERE closed_at IS NULL |
| 2 | Login con PIN | sessionStorage tiene pos_staff con name+role | Verificar pos_staff en Supabase, PIN correcto |
| 3 | Abrir mesa 5 | Navega a /pos?mesa=5, menu visible | URL correcta, menu carga, categorias visibles |
| 4 | Agregar 1 cocina + 1 barra + mods | Items en lista izquierda con precio | ModifierModal abre, mods se agregan |
| 5 | Enviar a cocina | Toast "X items enviados", comanda imprime | Bridge health, impresora encendida, print queue |
| 6 | KDS recibe (< 3s) | Card aparece en /pos/cocina | Polling activo, Supabase tiene la orden |
| 7 | KDS: 1 click item | Item cambia a amarillo "Preparando" | localStorage kds_item_status |
| 8 | KDS: 2 clicks item | Item desaparece de la card | Debounce 500ms funciona |
| 9 | Cobrar efectivo | Cajon abre, ticket imprime, orden status=cerrada | Bridge /drawer, printer /print |
| 10 | Cobrar tarjeta | Cajon NO abre, ticket imprime | openCashDrawer no se llama |
| 11 | Cobrar mixto | Cajon abre (tiene efectivo), ticket imprime | pagos array con multiples metodos |
| 12 | Reimprimir ticket | Ticket sale de nuevo con marca REIMPRESION | audit: ticket_reprinted |
| 13 | Corte X | Snapshot sin cerrar turno | /pos/turno → Corte X |
| 14 | Cierre turno | Wizard 4 pasos, diferencia calculada, turno cerrado | pos_turnos.closed_at, pos_cierres |

---

## STRESS TEST — Intentar romper

| # | Escenario | Qué debería pasar | Qué puede salir mal |
|---|-----------|-------------------|-------------------|
| 1 | Dos terminales misma mesa | checkOrderConflict bloquea el segundo cobro | Si ambos envian antes de que el otro guarde, items JSON se sobreescribe |
| 2 | Doble click en item KDS | Debounce 500ms previene saltar a "listo" | Si falla debounce, item desaparece sin pasar por preparando |
| 3 | Refresh browser POS | Orden se recarga de Supabase via loadMesaOrder | Draft no guardado se pierde |
| 4 | Refresh browser KDS | itemStatus se recupera de localStorage | Items vuelven al estado guardado, no a cero |
| 5 | Bridge reiniciado | Print queue reintenta cuando bridge vuelve | Comandas en queue se imprimen al reconectar |
| 6 | Impresora apagada | Bridge retorna 502, queue escala a needs_attention | Banner rojo en POS, retry automatico |
| 7 | Internet cae 2 min | Ordenes se guardan en IndexedDB, sync al reconectar | 409 en sync hace PATCH fallback |
| 8 | Dos ordenes simultaneas | Cada una tiene ID unico, ambas se guardan | Si misma mesa, posible orden fantasma |
| 9 | Dos pagos simultaneos | checkOrderConflict bloquea segundo | Si status ya es cerrada, bloquea |
| 10 | Cambio rapido de usuario | sessionStorage se limpia, nuevo login | Si no se limpia, permisos del usuario anterior |
| 11 | Orden de 20 platillos | Scroll funciona, impresion larga | Ticket largo puede cortar |
| 12 | Cancelar item enviado | CancelModal con PIN, audit log | Solo desde POS, no desde KDS |
| 13 | Cambiar mesa | mesa_transferred en audit | Si dos terminales, puede revertirse |
| 14 | Reabrir orden cerrada | reopenOrder con PIN gerente | Market stock no se revierte (aceptado P1) |

---

## OBSERVABILIDAD — Donde mirar

### Bridge
```
Terminal caja: http://127.0.0.1:7717/health
Terminal entrada: http://127.0.0.1:7717/health
Logs: la ventana del CMD muestra cada request con timestamp
```

### Supabase
```
Dashboard: https://supabase.com/dashboard/project/qjiomlvudfmzuvqvhwpk
Tablas clave:
  pos_orders → ordenes del dia
  pos_turnos → turno activo
  pos_audit_log → todas las acciones
  pos_cierres → cierres de turno
  pos_cash_movements → retiros/depositos
```

### POS (consola del browser)
```
F12 → Console en Chrome
Buscar:
  [printer] → logs de impresion
  [print-queue] → cola de reintentos
  [offline-sync] → sincronizacion
  [inventory] → deducciones
  Error → cualquier error rojo
```

### Detectar eventos perdidos
```sql
-- Ordenes enviadas hoy sin audit log
SELECT o.id, o.mesa, o.created_at
FROM pos_orders o
WHERE o.created_at >= CURRENT_DATE
AND NOT EXISTS (
  SELECT 1 FROM pos_audit_log a
  WHERE a.details::text LIKE '%' || o.id || '%'
)
```

### Detectar duplicados
```sql
-- Ordenes duplicadas por mesa+timestamp
SELECT mesa, created_at, COUNT(*)
FROM pos_orders
WHERE created_at >= CURRENT_DATE
GROUP BY mesa, created_at
HAVING COUNT(*) > 1
```

---

## ROLLBACK — Si algo falla

| Falla | Detectar | Mitigar | Tiempo recovery |
|-------|----------|---------|----------------|
| **Bridge cae** | Health check falla, no imprime | CMD → cd C:\fullsite → node bridge.js | 30 seg |
| **Impresora no responde** | Comanda no sale, banner rojo en POS | Verificar papel, encendida, red. Restart bridge si TCP | 1-2 min |
| **POS no sincroniza** | "X pendientes" en header, ordenes no aparecen en corte | Verificar internet. Si OK, F5 para recargar | 1 min |
| **KDS no actualiza** | Ordenes no aparecen despues de 5 seg | F5 en pantalla cocina. Verificar internet | 30 seg |
| **Dashboard sin datos** | Pagina en blanco o datos de ayer | Usar /pos/corte para datos reales del turno | Inmediato |
| **Internet cae** | Indicador offline en POS | Seguir operando. Ordenes se guardan local. NO editar misma mesa en 2 terminales | Auto-recovery |
| **Cajon no abre** | Click en cobrar efectivo, cajon cerrado | Abrir con llave. Verificar cable RJ-11 y bridge | 1 min |
| **Doble cobro** | Dos tickets para misma mesa | Reabrir una, cancelar con PIN gerente | 2 min |
| **Staff no puede entrar** | PIN rechazado | Verificar pos_staff en Supabase. Crear PIN temporal | 2 min |
| **TODO FALLA** | Multiples problemas simultaneos | **ABRIR WANSOFT.** No desinstalado. Login normal. Documentar incidente | 30 seg |

---

## WAR ROOM — Responsables

| Rol | Persona | Contacto | Responsabilidad |
|-----|---------|----------|----------------|
| Implementador | Daniel | Presencial | Todo: bridge, POS, KDS, impresoras, decisiones |
| Soporte operativo | Eduardo | Presencial (~5pm) | Permisos, flujo operativo, KDS, feedback |
| Gerente AMALAY | (confirmar) | En sitio | GO/NO-GO, autorizar rollback |
| Soporte remoto | Claude | Terminal de Daniel | Codigo, Supabase, diagnostico |

---

## GO / NO-GO (07:00)

**GO si todos pasan:**
- [ ] Bridge health OK ambas terminales
- [ ] 6 impresoras responden
- [ ] Smoke test completo (12 pasos)
- [ ] KDS recibe < 3 seg
- [ ] 1 cobro de prueba exitoso
- [ ] Gerente dice GO

**NO-GO → Wansoft:**
- Bridge no responde 2+ intentos
- Cocina no imprime > 2 min
- KDS no recibe > 1 min
- 3+ incidentes en 30 min
- Gerente dice NO-GO

---

## DURANTE EL TURNO — Protocolo

### Cada 30 minutos
- Bridge health check (ambas terminales)
- Verificar que no hay ordenes stuck en KDS
- Preguntar al staff: "¿algo raro?"

### Al detectar un problema
1. ¿Afecta ventas? Si NO → documentar y seguir
2. ¿Se resuelve en 5 min? Si SI → resolver
3. ¿Se resuelve en 15 min? Si NO → **esa mesa va a Wansoft**
4. ¿Es sistemico? Si SI → **todo a Wansoft**

### Log de incidentes
```
| Hora | Terminal | Mesa | Problema | Resolucion | Tiempo | Wansoft? |
|------|----------|------|----------|------------|--------|----------|
```

---

## AL CERRAR — Reconciliacion

- [ ] Total ordenes Fullsite = total esperado
- [ ] Formas de pago cuadran
- [ ] Cancelaciones registradas en audit log
- [ ] Descuentos registrados
- [ ] Diferencia de caja < $100
- [ ] Sin ordenes stuck (enviada/preparando > 4h)
- [ ] Bridge uptime continuo (ver logs CMD)

---

## LAS 20 COSAS QUE PUEDEN SALIR MAL

| # | Escenario | Deteccion | Solucion |
|---|-----------|-----------|----------|
| 1 | Mesero toca donde no era | Ve item equivocado en orden | Eliminar item, agregar correcto |
| 2 | Chef refresca KDS | Items vuelven a estado guardado | Verificar localStorage, re-tocar si necesario |
| 3 | Internet se cae | Indicador offline | Seguir operando, no 2 terminales misma mesa |
| 4 | Impresora sin papel | Comanda no sale | Poner papel, retry en print queue |
| 5 | Bridge CMD cerrado | No imprime | Alguien re-abre CMD, cd C:\fullsite, node bridge.js |
| 6 | Cajero cobra dos veces | Dos tickets | checkOrderConflict deberia bloquear. Si no, reabrir+cancelar |
| 7 | Gerente busca reporte | No lo encuentra | Usar /pos/corte, no dashboard |
| 8 | POS queda en mesa incorrecta | Ve items de otra mesa | Ir a /pos/mesas, seleccionar mesa correcta |
| 9 | Orden no llega a KDS | Chef no ve comanda | Verificar Supabase, re-enviar si necesario |
| 10 | Modificador no aparece en comanda | Chef prepara mal | Verificar print, re-imprimir si necesario |
| 11 | Cajon no abre | Cajero necesita dar cambio | Abrir con llave, verificar RJ-11 |
| 12 | Comanda duplicada | Chef ve dos iguales | Ignorar duplicada, documentar |
| 13 | Staff no recuerda PIN | No puede entrar | Crear PIN temporal en Supabase |
| 14 | Split no cuadra | Cuentas suman diferente al total | Verificar calcSplitParejo/Items |
| 15 | Propina no se registra | No aparece en corte | Verificar que se capturo antes de cobrar |
| 16 | Descuento sin PIN | No deberia pasar (PIN requerido) | Si pasa, es bug — documentar |
| 17 | Orden offline no sincroniza | "X pendientes" persiste | Verificar internet, forzar sync manual |
| 18 | KDS muestra orden vieja (>4h) | Confunde a cocina | Auto-archive deberia limpiar. F5 si no |
| 19 | Dos meseros misma mesa | Items mezclados | checkOrderConflict, recargar mesa |
| 20 | Terminal se congela | Pantalla no responde | F5 refresca. Si no, cerrar Chrome y reabrir |

---

> War Room activo martes 8 julio 2026.
> Imprimir este documento y tenerlo en mano.
> Fullsite RC1 — Restaurant Operating System
