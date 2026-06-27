# PRE-FLIGHT CHECKLIST — AMALAY

Objetivo: llegar al restaurante con la mayor cantidad de problemas resueltos.
Minimizar tiempo in situ. Maximizar probabilidad de exito.

---

## 1. SOFTWARE (verificable antes de ir)

| # | Item | Status | Notas |
|---|------|--------|-------|
| S1 | Menu items importados | OK (522 items) | Verificar precios actuales vs Wansoft |
| S2 | Staff con PINs | OK (50 staff, 50 con PIN) | Verificar que PINs son los correctos (no demo) |
| S3 | Payment methods | OK (10 metodos) | Efectivo, TC, TD, Transfer, UberEats, Rappi, DiDi, Clip, NetPay, aDomicilio |
| S4 | Station routing (cocina/barra/caja) | OK | 40+ keywords bebidas, 18+ caja. Default=cocina |
| S5 | Mesas configuradas | OK (31 mesas) | Hardcoded del plano fisico |
| S6 | Service Worker v2 | OK | Cache shell + API network-first |
| S7 | PWA manifest | OK | Fullscreen, landscape, kiosk mode |
| S8 | Offline sync (IndexedDB) | OK | Certificado OFF-02 E2E |
| S9 | Print queue persistencia | OK | BUG-005 certificado, sobrevive redirect |
| S10 | Audit queue offline | OK | A3 certificado |
| S11 | Cobro (efectivo/tarjeta/mixto/propina) | OK | COBRO-01 a COBRO-04 certificados |
| S12 | Corte de caja | OK | COBRO-06/10 certificado |
| S13 | Bloqueo cobro sin envio | OK | COBRO-00 certificado |
| S14 | Facturama API endpoint | OK (codigo) | FALTA: cuenta Facturama activa ($1,650) |
| S15 | Turnos tabla | OK | Columnas: opened_by, fondo_inicial, opened_at, closed_by, closed_at |

### Acciones ANTES de ir

- [ ] **Activar Facturama** — pagar $1,650, obtener API key, configurar en env
- [ ] **Verificar PINs con Monica/Eduardo** — confirmar que los 50 PINs son los reales del staff, no datos de prueba
- [ ] **Verificar precios** — comparar 20 items mas vendidos contra precios actuales de Wansoft
- [ ] **Preparar USB con print bridge** — copiar `fullsite-print-bridge-win64.zip` (existe en `/Users/danielrg/fullsite-os/dist/`) a USB para instalar en terminal Windows
- [ ] **Probar timbrado CFDI end-to-end** — crear un CFDI de prueba con Facturama sandbox antes de ir

---

## 2. HARDWARE (solo verificable in situ)

| # | Item | Verificar | Como |
|---|------|-----------|------|
| H1 | Terminal POS principal | Windows version, Chrome/Edge instalado y actualizado | Settings > About |
| H2 | Monitor KDS cocina | Que pantalla es, que resolucion, como esta conectada | Visual + Settings |
| H3 | Impresora cocina | Marca, modelo, IP, tipo conexion (USB/Ethernet/WiFi) | Pagina test de impresora |
| H4 | Impresora barra | Marca, modelo, IP, tipo conexion | Pagina test de impresora |
| H5 | Impresora caja/ticket | Marca, modelo, IP, tipo conexion | Pagina test de impresora |
| H6 | Cajon de dinero | Conectado a que impresora, que pin usa | Verificar cable |
| H7 | Lector de codigo de barras (si existe) | USB? Bluetooth? | Probar scan |
| H8 | Terminal de tarjeta (Clip/NetPay) | Modelo, conexion, integracion | Manual o standalone? |

### Acciones in situ

- [ ] Anotar IP/MAC de cada impresora
- [ ] Anotar modelo exacto de cada impresora
- [ ] Verificar que todas estan en la misma red que la terminal
- [ ] Foto de cada equipo con su ubicacion

---

## 3. RED (solo verificable in situ)

| # | Item | Verificar | Como |
|---|------|-----------|------|
| R1 | WiFi en salon | Cobertura, nombre de red, password | Conectar telefono, hacer speed test |
| R2 | WiFi en cocina | Cobertura (cocina suele tener interferencia) | Speed test desde ubicacion del KDS |
| R3 | WiFi en barra | Cobertura | Speed test |
| R4 | Acceso a Supabase | Que no haya firewall corporativo bloqueando | `curl https://qjiomlvudfmzuvqvhwpk.supabase.co/rest/v1/` desde terminal |
| R5 | Acceso a Vercel | Que app.fullsite.mx cargue | Abrir en browser de la terminal |
| R6 | Acceso local bridge | 127.0.0.1:7717 accesible desde browser | Abrir `http://127.0.0.1:7717/health` |
| R7 | IPs fijas vs DHCP | Las impresoras cambian IP? | Verificar config de router/DHCP |
| R8 | Latencia a Supabase | <200ms ideal, <500ms aceptable | `ping qjiomlvudfmzuvqvhwpk.supabase.co` |

### Acciones in situ

- [ ] Hacer speed test desde cada zona (salon, cocina, barra)
- [ ] Verificar que la terminal puede llegar a Supabase
- [ ] Verificar que la terminal puede llegar al bridge local
- [ ] Si las impresoras son Ethernet, verificar que estan en el mismo segmento de red
- [ ] Anotar nombre de red WiFi y password

---

## 4. PRUEBAS IN SITU (checklist de ejecucion)

### Fase 1 — Hardware y red (30 min)

- [ ] Terminal enciende y tiene Chrome/Edge actualizado
- [ ] `app.fullsite.mx` carga en la terminal
- [ ] Speed test desde la terminal: >5 Mbps down
- [ ] Instalar print bridge en terminal Windows
- [ ] Ejecutar print bridge: `fullsite-print-bridge.exe`
- [ ] Verificar `http://127.0.0.1:7717/health` responde OK desde browser
- [ ] Configurar IPs de impresoras en el bridge (config.json o argumentos)
- [ ] Foto de cada impresora con su IP anotada

### Fase 2 — Impresion (30 min)

- [ ] Test de impresion cocina: enviar bytes de prueba via bridge
- [ ] Test de impresion barra: enviar bytes de prueba via bridge
- [ ] Test de impresion ticket/caja: enviar bytes de prueba via bridge
- [ ] Test de cajon: enviar comando de apertura via bridge
- [ ] Flujo completo: abrir mesa en POS, agregar item, enviar → comanda sale por impresora cocina
- [ ] Flujo completo: cobrar con efectivo → ticket sale por impresora caja + cajon se abre
- [ ] Flujo multi-estacion: orden con item cocina + item barra → 2 comandas en 2 impresoras

### Fase 3 — POS end-to-end (30 min)

- [ ] Login con PIN de mesero real
- [ ] Abrir mesa real del plano
- [ ] Agregar 3 items (1 cocina, 1 barra, 1 market)
- [ ] Enviar a cocina → comanda cocina imprime, comanda barra imprime
- [ ] Ver orden en KDS cocina → avanzar status
- [ ] Cobrar con efectivo → ticket imprime, cajon abre
- [ ] Cobrar con tarjeta (segunda mesa) → ticket imprime, cajon NO abre
- [ ] Descuento con PIN gerente → audit log registra
- [ ] Cancelar item con PIN gerente → audit log registra
- [ ] Verificar corte de caja → numeros cuadran
- [ ] Abrir turno con fondo inicial
- [ ] Cerrar turno con arqueo

### Fase 4 — Offline (15 min)

- [ ] Desconectar WiFi de la terminal
- [ ] Crear orden offline → se guarda en IndexedDB
- [ ] Reconectar WiFi → sync automatico
- [ ] Verificar orden en Supabase

### Fase 5 — KDS (15 min)

- [ ] Abrir KDS en monitor de cocina (o segunda tab)
- [ ] Enviar orden desde POS → aparece en KDS
- [ ] Verificar legibilidad a distancia real de la cocina
- [ ] Avanzar status desde KDS → POS refleja cambio
- [ ] Verificar notificacion sonora

### Fase 6 — Facturacion (15 min, solo si Facturama activo)

- [ ] Desde POS, generar solicitud de factura
- [ ] Verificar que llega a cola de timbrado
- [ ] Timbrar CFDI de prueba
- [ ] Verificar XML y PDF generados

---

## Llevar al restaurante

- [ ] Laptop con acceso a codigo y Supabase
- [ ] USB con `fullsite-print-bridge-win64.zip`
- [ ] Cable Ethernet (backup si WiFi falla)
- [ ] Impresora termica USB 58mm (backup)
- [ ] Papel termico extra (58mm y 80mm)
- [ ] Libreta para anotar IPs, passwords, observaciones
- [ ] Telefono con speed test instalado
- [ ] Cargador laptop
- [ ] Este documento impreso o en tablet

---

## Criterio de exito de la visita

Al terminar la visita, poder responder SI a todas:

1. Las 3 impresoras imprimen desde Fullsite?
2. El cajon se abre desde Fullsite?
3. El KDS muestra ordenes en la pantalla de cocina?
4. Un mesero puede hacer login, tomar orden, enviar y cobrar?
5. El sistema funciona sin internet por al menos 2 minutos?
6. La facturacion esta lista (o tiene fecha de activacion)?

Si alguna es NO, documentar por que y que falta para resolverlo.
