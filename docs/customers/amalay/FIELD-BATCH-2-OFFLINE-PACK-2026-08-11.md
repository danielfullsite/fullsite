# AMALAY — Field Batch #2 Offline Pack

Fecha objetivo: esta semana  
Modo: prueba física controlada, sin deploy y sin cambios de DB durante la prueba  
Objetivo: demostrar que Fullsite puede operar una venta real con caída de internet, reinicio, KDS, impresión, cobro, reconexión y conciliación con `data_loss=0` y `duplicates=0`.

## Resultado esperado

PASS solo si se completa este recorrido:

`PIN → abrir turno → crear orden → enviar a KDS → imprimir comanda → cobrar → cortar internet → continuar operación → reiniciar app/equipo → reconectar → sincronizar → conciliación`

Y al final:

- No se perdió ninguna orden.
- No se duplicó ninguna orden.
- No se duplicó ninguna impresión lógica.
- El cobro quedó registrado una sola vez.
- El corte cuadra contra las órdenes cobradas.
- KDS recupera estado después de reconexión/reinicio.
- La cola offline queda vacía o con fallos explicados.

## Setup mínimo antes de empezar

No iniciar si falta algo de esto:

- Laptop/terminal AMALAY con Fullsite instalado.
- Caja/POS abre correctamente.
- PIN operativo conocido por el equipo.
- KDS abierto en pantalla/dispositivo real o simulado.
- Impresora o bridge de impresión listo.
- Método de cobro de prueba definido.
- Celular listo para video continuo.
- Capturas de dashboard/POS antes y después.
- Hora local exacta anotada al iniciar.

## Evidencia obligatoria

Guardar todo con timestamp:

1. Video corto del inicio: login/PIN y turno abierto.
2. Foto/video de orden creada en POS.
3. Foto/video de KDS recibiendo la orden.
4. Foto/video de impresión o cola de impresión.
5. Foto/video del corte de internet.
6. Foto/video del reinicio.
7. Foto/video de reconexión/sync.
8. Foto del ticket/cobro si aplica.
9. Foto del corte final.
10. Captura final de conteos: órdenes, pagos, print jobs, sync queue.

## Guion operativo

### 0. Baseline — 5 min

- Confirmar hora local.
- Abrir Fullsite.
- Confirmar tenant AMALAY visible.
- Confirmar que no hay banner de error crítico.
- Confirmar KDS abierto.
- Confirmar impresora/bridge visible o modo simulado definido.

PASS:

- POS, KDS y caja cargan.
- No hay error rojo bloqueante.

FAIL:

- No se puede entrar con PIN.
- KDS no abre.
- No hay forma de observar impresión/cola.

### 1. PIN + turno — 5 min

- Entrar al POS con PIN.
- Abrir turno nuevo o confirmar turno activo.
- Anotar `turno_id` si aparece o capturar pantalla.

PASS:

- Turno activo visible.
- POS permite capturar orden.

FAIL:

- El POS permite operar sin turno cuando debería exigirlo.
- El turno abre pero no queda persistido al refrescar.

### 2. Orden online inicial — 10 min

- Crear una orden simple con 1 producto de cocina y 1 producto de barra si existe.
- Enviar a cocina.
- Confirmar:
  - Orden aparece en KDS.
  - Comanda imprime o queda job visible en cola.
  - No hay doble comanda.

PASS:

- 1 orden.
- 1 comanda lógica por estación.
- KDS muestra la orden una vez.

FAIL:

- KDS no recibe.
- Se imprimen duplicados.
- La orden queda invisible.

### 3. Corte de internet — 10 min

- Cortar internet de la terminal principal.
- Sin cerrar Fullsite, crear una segunda orden o agregar producto a una orden existente.
- Enviar a cocina.
- Capturar si Fullsite marca modo offline / cola.

PASS:

- POS permite seguir operando.
- La operación queda en cola local.
- Si la impresión local/bridge está disponible, la operación no depende de internet.

FAIL:

- La UI se congela.
- Se pierde el carrito.
- No hay señal de cola/reintento.

### 4. Reinicio en offline — 10 min

- Manteniendo internet cortado, cerrar y reabrir la app/POS.
- Entrar con PIN.
- Verificar:
  - Turno sigue disponible o recuperable.
  - Orden offline sigue visible o recuperable.
  - Cola offline no desapareció.

PASS:

- Estado crítico sobrevive reinicio.

FAIL:

- Orden desaparece.
- Turno desaparece.
- Cola se vacía sin sync exitoso.

### 5. Cobro offline o recuperación segura — 10 min

Según el comportamiento actual certificado:

- Si el cobro offline está permitido: cobrar la orden y capturar evidencia.
- Si el cobro offline está bloqueado por diseño: confirmar bloqueo claro y cobrar al reconectar.

PASS:

- El sistema no inventa cobros.
- No cobra dos veces.
- Si bloquea, lo hace con mensaje entendible.

FAIL:

- Cobro duplicado.
- Cobro registrado sin orden.
- UI deja estado ambiguo.

### 6. Reconexión + conciliación — 15 min

- Reconectar internet.
- Esperar sync.
- Refrescar POS/dashboard.
- Confirmar:
  - Órdenes offline aparecen en cloud.
  - Pagos/cobros aparecen una vez.
  - Print jobs no se duplican.
  - KDS no duplica tickets.
  - Cola queda vacía o con error explícito.

PASS:

- `data_loss=0`.
- `duplicates=0`.
- Sync completo o fallos explícitos recuperables.

FAIL:

- Cualquier orden/cobro perdido.
- Cualquier duplicado no justificado.
- Cola stuck sin explicación.

### 7. Corte final — 10 min

- Hacer corte de turno.
- Verificar ventas del turno contra órdenes cobradas.
- Capturar corte.

PASS:

- Corte cuadra.
- No hay órdenes cobradas fuera del turno.
- No hay pagos huérfanos.

FAIL:

- Corte no cuadra.
- Pagos/órdenes huérfanos.
- Turno no cierra.

## Matriz de resultados

| Check | Evidencia | PASS/FAIL | Nota |
|---|---|---:|---|
| PIN funciona | video/captura |  |  |
| Turno abre/persiste | captura |  |  |
| Orden online creada | order id/foto |  |  |
| KDS recibe online | video |  |  |
| Impresión online | ticket/video/cola |  |  |
| Internet cortado | video |  |  |
| Orden offline capturada | captura |  |  |
| Reinicio offline recupera estado | video |  |  |
| Reconexión sincroniza | captura |  |  |
| `data_loss=0` | conteo antes/después |  |  |
| `duplicates=0` | conteo antes/después |  |  |
| Cobro correcto | recibo/captura |  |  |
| Corte cuadra | corte final |  |  |

## Comandos de verificación técnica post-prueba

Ejecutar solo si se tiene acceso seguro al entorno correcto y sin imprimir secretos:

```bash
# Confirmar rama/commit de app instalada
git -C /Users/danielrg/fullsite rev-parse --short HEAD

# Revisar logs locales recientes del bridge/server si aplica
ls -lt ~/Library/Logs 2>/dev/null | head

# Buscar evidencia local de errores sin mostrar credenciales
rg -n "ERROR|FAILED|duplicate|data_loss|sync|print" electron-app dashboard-app --glob '!node_modules' | head -80
```

## Criterios de bloqueo P0

Detener rollout si ocurre cualquiera:

- Una orden desaparece después de reconectar.
- Una orden o cobro se duplica.
- KDS no recibe órdenes enviadas.
- La impresión de comanda falla sin cola/reintento/visibilidad.
- Turno/corte no cuadran.
- Login/PIN falla durante operación normal.
- El sistema necesita intervención manual no documentada para recuperar datos.

## Fix policy

Si falla algo:

1. No tocar producción en caliente salvo emergencia autorizada.
2. Capturar video/log exacto.
3. Reproducir local/staging si es posible.
4. Hacer fix mínimo.
5. Certificar solo el fallo.
6. Repetir Field Batch #2 completo antes de declararlo PASS.

## Estado del pack

Listo para ejecución física.  
Este archivo no certifica nada por sí solo; solo define el recorrido y la evidencia necesaria.
