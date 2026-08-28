# Tutorial — de cero a operación básica (< 60 min)

> Camino guiado para dejar un restaurante clon operando lo básico: cliente → sucursales → menú
> → usuarios → dispositivos → impresoras → prueba → activación. Sobre un tenant de **sandbox**
> (`demo` / `<tenant>-demo`), **nunca AMALAY ni producción**.
>
> **Aviso de estado.** Los PRs del programa **no están desplegados** (ver [`README.md`](README.md)).
> Este tutorial describe el flujo objetivo; los pasos marcados **[requiere wiring Electron]**
> dependen de un instalador que aún no se arma (ver [ADR-0006](adr.md)).

## Antes de empezar (5 min)

- Acceso de admin de plataforma con 2FA (`<ADMIN>`).
- Un tenant de sandbox: usa `demo` o crea `<tenant>-demo`. **No uses datos reales de AMALAY.**
- Feature flags del programa **apagados** = comportamiento legacy; enciéndelos por tenant
  conforme avances (tabla en [`referencia.md`](referencia.md) §8).

## Minuto 0–10 · Cliente y sucursales

1. Ejecuta `provisionTenant()` para `<tenant>-demo` (idempotente). Siembra cliente + una sucursal
   "Principal" + menú/pagos/staff/mesas base.
2. Agrega las sucursales del grupo en `client_locations` (una fila por marca/sucursal).
3. Verifica: `GET /api/platform/locations?clientId=<tenant>-demo`.

## Minuto 10–25 · Menú y usuarios

4. Ajusta menú/categorías (el seed trae base; edítalo a la carta real del piloto).
5. Usuarios: crea el staff por rol. **Los PIN se fijan en el POS/panel, nunca se exportan ni se
   escriben en docs** (el wizard reanudable **descarta** cualquier secreto del estado, ADR-0007).

## Minuto 25–40 · Dispositivos e impresoras

6. Por cada terminal: `POST /api/platform/terminals` → obtén `device_id` + `enrollment_code`.
   Anota el código de forma efímera (se muestra una vez).
7. En la caja, canjea el código (`terminal-claim`) o importa el `config.json` del wizard.
8. Declara estaciones de cada sucursal en `pos_location_stations`; enciende
   `factory.stations_per_location`.
9. **[requiere wiring Electron]** Descubrimiento de impresoras: la caja recolecta evidencia
   (LAN/USB/HID) y `POST /api/platform/hardware/propose` la rankea. **Confirma** la propuesta
   (nunca se guarda sin confirmación); usa fallback manual si la confianza es baja.

## Minuto 40–55 · Prueba de punta a punta

10. Abre un turno para `(<tenant>-demo, <sucursal>)`.
11. Enciende `factory.kds_location_scope`; abre el KDS enviando `location_id` + `shift_id`.
    Verifica que **sólo** aparecen las comandas de esa sucursal/turno.
12. Manda una orden con items de dos estaciones (p. ej. una bebida y un plato) y confirma que se
    enrutan por estación.
13. **[requiere wiring Electron]** Imprime la comanda en cada estación; corre el corte X.
14. **[requiere wiring Electron]** Prueba offline: desconecta la WAN, sigue vendiendo, reconecta,
    confirma que la cola drena. Mide con el harness de latencia (#201) si el hot path ya está
    instrumentado.

## Minuto 55–60 · Activación

15. Corre la suite local (ver [`howto.md`](howto.md) §Pruebas) — debe salir verde.
16. Marca el tenant como activo. Deja registrado en [`runbooks.md`](runbooks.md) el paso a
    piloto.

## Qué queda fuera de "operación básica"

- Métricas de latencia en campo, escaneo real de hardware, y `location_id` obligatorio en el
  schema del Electron → **requieren instalador** (ADR-0006).
- Ejecución confirmada de propuestas de soporte/IQ → endpoints separados, fuera del lote actual.
