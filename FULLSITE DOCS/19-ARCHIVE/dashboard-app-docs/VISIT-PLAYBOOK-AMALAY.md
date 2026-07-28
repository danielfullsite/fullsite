# PLAYBOOK — Visita AMALAY 2026-06-28

Objetivo: cerrar la mayor cantidad de P0 del cutover checklist.
No improvisar. Seguir el runbook.

## Llevar

- [ ] USB con `fullsite-print-bridge-win64.zip` + `printers.json`
- [ ] USB con NSSM (descargar de nssm.cc antes de salir)
- [ ] Laptop con acceso a Supabase, codigo, y este documento
- [ ] Cable Ethernet (backup)
- [ ] Papel termico (58mm y 80mm)
- [ ] Libreta + pluma
- [ ] Telefono con camara (evidencia)
- [ ] Cargador laptop
- [ ] Este documento impreso

---

## Runbook cronologico

### 08:00 — Llegada y setup (15 min)

- [ ] Encender terminal POS principal
- [ ] Verificar que Chrome/Edge esta actualizado en la terminal
- [ ] Abrir `app.fullsite.mx` en la terminal — verificar que carga
- [ ] Speed test WiFi desde la terminal (anotar resultado)
- [ ] Speed test WiFi desde ubicacion del KDS cocina
- [ ] Foto de la terminal con su ubicacion

### 08:15 — Validacion Wansoft: precios (30 min)

Abrir Wansoft en la terminal. Navegar a la pantalla de catalogo de productos.

**Caminito en Wansoft:**
- Inicio → Configuracion → Catalogo de Platillos
- O: Inicio → Admin → Platillos (depende de la version)

**Para cada uno de los 9 items P0 Price Mismatch:**

| Item | Fullsite (sin IVA) | Buscar en Wansoft | Anotar precio Wansoft | Match? |
|------|--------------------|--------------------|----------------------|--------|
| Enchiladas Suizas | $255 | | | |
| Combo Fit | $250 | | | |
| Egg and Pancake Combo | $250 | | | |
| Avocado Toast | $240 | | | |
| Machacado con Huevo | $240 | | | |
| Croissant Nutella | $99 | | | |
| Coca Cola Regular | $60 | | | |
| Jugo Verde de la Casa | $95 | | | |
| Concha de Mantequilla | $52 | | | |

Si el precio de Wansoft NO coincide con Fullsite: corregir inmediatamente en Supabase
(`pos_menu_items` → UPDATE price WHERE name = X).

**Tambien verificar:** el menu fisico del restaurante (carta impresa o pizarron).
El precio de Fullsite debe coincidir con lo que el cliente ve, no con Wansoft.

### 08:45 — Validacion Wansoft: items faltantes (20 min)

**Caminito en Wansoft:**
- Configuracion → Catalogo de Platillos → filtrar por grupo/categoria
- O exportar lista completa si es posible

**Objetivo:** de los 154 items que estan en Wansoft pero no en Fullsite,
identificar cuales son activos y cuales estan descontinuados.

**Metodo rapido:**
1. Abrir Wansoft catalogo
2. Buscar los items que NO estan en Fullsite
3. Preguntar a Monica/staff: "este item se vende actualmente?"
4. Si SI: anotarlo para agregarlo a Fullsite
5. Si NO: marcarlo como descontinuado (no accion)

**Anotar:** cuantos items activos faltan. Si son <5, corregir en el momento.
Si son >10, programar una sesion de importacion antes del cutover.

### 09:05 — Validacion Wansoft: PINs y staff (10 min)

**Caminito en Wansoft:**
- Configuracion → Empleados
- O: Admin → Personal

**Verificar:**
- Lista de empleados activos en Wansoft
- Comparar contra los 50 registros en `pos_staff` de Supabase
- Confirmar con Monica: los PINs en Fullsite son los mismos que en Wansoft?
- Si hay PINs diferentes: actualizar en Supabase

**Anotar:** cuantos empleados activos hay realmente (vs los 50 en BD).

### 09:15 — Validacion Wansoft: metodos de pago (5 min)

**Caminito en Wansoft:**
- Configuracion → Formas de Pago

**Verificar:**
- Lista de formas de pago activas en Wansoft
- Comparar contra los 10 en `pos_payment_methods`
- Falta alguna? Sobra alguna?

### 09:20 — Validacion Wansoft: impresoras (10 min)

**Caminito en Wansoft:**
- Configuracion → Impresoras
- O: Admin → Dispositivos → Impresoras

**Anotar para cada impresora:**
- Nombre en Wansoft
- IP o nombre de cola Windows
- Tipo (USB/TCP/Windows)
- Estacion (cocina/barra/caja/tickets)
- Foto del equipo fisico con su ubicacion

**Comparar contra `printers.json`:**
```json
{
  "cocina": [192.168.1.21, 192.168.1.40],
  "barra": 192.168.1.30,
  "caja": "PANADERIA" (Windows),
  "tickets": "EC TICKET" (Windows)
}
```

Si alguna IP cambio: actualizar printers.json antes de instalar.

### 09:30 — Instalar bridge + NSSM (20 min)

1. [ ] Crear carpeta `C:\fullsite\` si no existe
2. [ ] Copiar `fullsite-print-bridge.exe` desde USB
3. [ ] Copiar `printers.json` actualizado con IPs verificadas
4. [ ] Copiar `raw-print.ps1` (para impresoras Windows/USB)
5. [ ] Ejecutar `fullsite-print-bridge.exe` manualmente → verificar consola
6. [ ] Abrir `http://127.0.0.1:7717/health` en Chrome → debe responder OK
7. [ ] Si firewall bloquea: agregar excepcion para puerto 7717
8. [ ] Instalar NSSM:
   - Copiar `nssm.exe` a `C:\fullsite\`
   - Abrir PowerShell como Administrador
   - `C:\fullsite\nssm.exe install FullsitePrintBridge C:\fullsite\fullsite-print-bridge.exe`
   - `C:\fullsite\nssm.exe set FullsitePrintBridge AppDirectory C:\fullsite`
   - `C:\fullsite\nssm.exe start FullsitePrintBridge`
9. [ ] Verificar que el servicio esta corriendo: `http://127.0.0.1:7717/health`
10. [ ] Reiniciar la computadora y verificar que el bridge arranca solo

### 09:50 — Test de impresion (20 min)

Desde `app.fullsite.mx/pos` en la terminal:

1. [ ] Login con PIN de mesero real
2. [ ] Abrir mesa disponible
3. [ ] Agregar 1 item de cocina (ej: Chilaquiles)
4. [ ] Agregar 1 item de barra (ej: Cafe Americano)
5. [ ] Agregar 1 item de market/caja (ej: Croissant)
6. [ ] Enviar → verificar:
   - [ ] Comanda sale en impresora cocina (2 copias)
   - [ ] Comanda sale en impresora barra
   - [ ] Comanda sale en impresora caja/market
7. [ ] Cobrar con efectivo → verificar:
   - [ ] Ticket sale en impresora tickets
   - [ ] Cajon de dinero se abre
8. [ ] Si alguna impresora falla: verificar IP, cable, Windows print queue

**Evidencia:** foto de cada comanda/ticket impreso.

### 10:10 — Test KDS (10 min)

1. [ ] Abrir `app.fullsite.mx/pos/cocina` en el monitor de cocina
2. [ ] Enviar orden desde la terminal POS
3. [ ] Verificar que la orden aparece en KDS
4. [ ] Verificar legibilidad a la distancia real de la cocina (anotar)
5. [ ] Avanzar status: enviada → preparando → lista
6. [ ] Verificar notificacion sonora

**Evidencia:** foto del KDS con una orden real visible.

### 10:20 — Test offline (10 min)

1. [ ] Desconectar WiFi de la terminal
2. [ ] Crear orden, enviar
3. [ ] Verificar toast "Offline"
4. [ ] Reconectar WiFi
5. [ ] Verificar sync automatico
6. [ ] Verificar orden en Supabase

### 10:30 — Verificar datos pendientes (10 min)

Si durante las validaciones encontramos:
- Precios incorrectos → corregir en Supabase ahora
- Items faltantes → agregar a pos_menu_items ahora
- PINs incorrectos → actualizar en pos_staff ahora
- Metodos de pago faltantes → agregar a pos_payment_methods ahora

### 10:40 — Capacitacion staff (1.5 horas)

**Grupo 1: Meseros (30 min)**
- Login con PIN
- Abrir mesa en el plano
- Agregar items (buscar, categorias, modificadores)
- Sillas y tiempos
- Enviar a cocina
- Ver "Enviado" confirmacion
- Cobrar con efectivo (cambio)
- Cobrar con tarjeta
- Que hacer si no hay internet (modo offline)
- Que hacer si aparece banner rojo de impresion

**Grupo 2: Cajero (30 min)**
- Todo lo de meseros +
- Cobro mixto
- Propina
- Descuento con PIN gerente
- Corte X (snapshot)
- Abrir turno con fondo
- Cerrar turno con arqueo
- Facturacion (si Facturama activo)

**Grupo 3: Cocina (15 min)**
- KDS: ver ordenes
- Avanzar status (tap en boton)
- Cancelar item (con PIN gerente)
- Notificacion sonora de nueva orden

**Grupo 4: Gerente (15 min)**
- PIN de gerente para descuentos
- PIN para cancelaciones
- Reapertura de orden
- Corte de caja completo
- Monitor (/pos/monitor)

### 12:10 — Shadow parcial (opcional, si el turno lo permite)

Si hay mesas disponibles y el staff se siente comodo:
- Operar 2-3 mesas reales en Fullsite
- Wansoft queda abierto como respaldo
- Documentar cada incidente

### 12:30 — Cierre y documentacion (15 min)

Completar este checklist de salida:

- [ ] Todas las impresoras imprimen desde Fullsite?
- [ ] El cajon se abre desde Fullsite?
- [ ] El bridge arranca automaticamente (NSSM)?
- [ ] El KDS muestra ordenes en la cocina?
- [ ] Un mesero completo el flujo (mesa → enviar → cobrar)?
- [ ] Los precios de los 9 items P0 estan verificados?
- [ ] Los PINs del staff estan confirmados?
- [ ] Los metodos de pago estan completos?
- [ ] El sistema funciona offline?

**Anotar para Post-Implementation Report:**
1. Que salio mejor de lo esperado?
2. Que fallo?
3. Que sorprendio al staff?
4. Que preguntaron mas?
5. Que parte del producto genero mas friccion?
6. Que decision deberiamos tomar esta semana?

---

## Lo que NO tocar durante la visita

- No cambiar codigo del POS
- No modificar la base de datos de Wansoft
- No desinstalar Wansoft
- No cambiar la red WiFi ni el router
- No prometer fechas de cutover al staff
- No instalar software adicional (solo bridge + NSSM)
- No hacer cambios de UX/diseño

---

## Contingencia rapida

| Si pasa esto... | Hacer esto |
|-----------------|------------|
| Bridge no inicia | Verificar firewall. Ejecutar como admin. Verificar puerto 7717 |
| Impresora no responde | Verificar IP con `ping`. Verificar cable. Imprimir pagina test desde Windows |
| WiFi inestable | Usar cable Ethernet como backup |
| PIN no funciona | Verificar en Supabase. Crear PIN temporal |
| Precio incorrecto | Corregir en Supabase via laptop |
| Item falta en menu | Agregar a pos_menu_items via laptop |
| Staff rechaza el sistema | Escuchar, anotar, no forzar. Documentar para el Post-Implementation Report |
