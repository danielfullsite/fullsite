# FULLSITE DEPLOYMENT SYSTEM

Sistema de implementacion repetible para cualquier restaurante.
Disenado para que un implementador pueda ejecutarlo sin depender del fundador.

Version: 1.0 (basado en AMALAY, primer cliente)
Actualizar con lecciones de cada implementacion.

---

## Las 13 fases

```
Lead → Kickoff → Recoleccion → Auditoria HW → Migracion →
Configuracion → Instalacion → Capacitacion → Shadow Day →
Cutover → Hypercare → Cierre → Success Review
```

---

## Fase 1 — Lead ganado

**Objetivo:** confirmar que el restaurante es un buen fit para Fullsite.

**Inputs:**
- Contacto del restaurante (nombre, telefono, email)
- Tipo de restaurante (casual, fine dining, QSR, cafeteria)
- Volumen aproximado (mesas, ordenes/dia, meseros)

**Checklist:**
- [ ] El restaurante tiene internet estable
- [ ] Tiene al menos 1 terminal (PC/tablet) para el POS
- [ ] Tiene impresoras termicas (o esta dispuesto a comprarlas)
- [ ] Tiene un POS actual (cual: Wansoft, Soft Restaurant, otro, ninguno)
- [ ] Tiene facturacion electronica (o la necesita)
- [ ] Decision maker identificado (dueno, gerente, socio)
- [ ] Presupuesto y forma de pago acordados

**Output:** contrato firmado o acuerdo verbal con fecha de inicio.

**Responsable:** ventas / fundador.

**Criterio de salida:** el restaurante confirmo que quiere proceder.

---

## Fase 2 — Kickoff

**Objetivo:** alinear expectativas y definir timeline.

**Inputs:**
- Contrato o acuerdo
- Contacto operativo (gerente/encargado del restaurante)

**Checklist:**
- [ ] Reunion de kickoff con decision maker + gerente (30 min)
- [ ] Explicar el proceso de implementacion (las 13 fases)
- [ ] Definir contacto principal del restaurante
- [ ] Definir canal de comunicacion (WhatsApp group)
- [ ] Acordar fecha tentativa de cutover
- [ ] Solicitar acceso al POS actual (si existe)
- [ ] Solicitar menu actualizado (PDF, foto, o acceso al sistema)
- [ ] Solicitar lista de empleados con roles

**Output:** timeline acordado, contactos definidos, accesos solicitados.

**Responsable:** implementador.

**Criterio de salida:** el restaurante sabe que esperar y cuando.

---

## Fase 3 — Recoleccion de informacion

**Objetivo:** obtener toda la informacion necesaria para configurar Fullsite.

**Inputs:**
- Acceso al POS actual
- Menu del restaurante
- Lista de empleados

**Checklist:**
- [ ] Exportar catalogo de productos del POS actual (nombre, precio, categoria)
- [ ] Exportar lista de formas de pago
- [ ] Exportar lista de empleados con roles
- [ ] Obtener plano de mesas / layout del restaurante
- [ ] Documentar estaciones de impresion (que grupo va a que impresora)
- [ ] Documentar datos fiscales (RFC, razon social, regimen, CP)
- [ ] Documentar horarios de operacion
- [ ] Identificar: usan descuentos? cortesias? splits? tiempos? delivery?

**Output:** carpeta del cliente con todos los datos recolectados.

**Responsable:** implementador.

**Criterio de salida:** toda la informacion necesaria esta disponible para configurar.

---

## Fase 4 — Auditoria de hardware y red

**Objetivo:** verificar que la infraestructura del restaurante soporta Fullsite.

**Inputs:**
- Visita al restaurante (o fotos + acceso remoto)

**Checklist:**
- [ ] Terminal POS: tipo, OS, browser, pantalla touch
- [ ] Impresoras: marca, modelo, conexion (USB/TCP/WiFi), IP
- [ ] Cajon de dinero: conectado a que impresora
- [ ] Monitor KDS cocina: tipo, resolucion, conexion
- [ ] Red WiFi: cobertura salon, cocina, barra (speed test)
- [ ] Acceso a internet: proveedor, velocidad, estabilidad
- [ ] UPS / respaldo de energia: existe?
- [ ] Foto de cada equipo con su ubicacion

**Output:** inventario de hardware + reporte de red.

**Responsable:** implementador.

**Criterio de salida:** se sabe exactamente que hardware hay y que falta.

---

## Fase 5 — Migracion de datos

**Objetivo:** importar toda la informacion del restaurante a Fullsite.

**Inputs:**
- Datos recolectados en fase 3
- Exports del POS anterior

**Checklist:**
- [ ] Importar productos con precios y categorias
- [ ] Generar Migration Diff Report (precios, items, impuestos)
- [ ] Verificar precios contra menu fisico del restaurante
- [ ] Importar empleados con PINs y roles
- [ ] Configurar formas de pago (con claves CFDI)
- [ ] Configurar mesas / layout
- [ ] Importar recetas (si aplica)
- [ ] Importar modificadores / extras
- [ ] Verificar que no faltan items activos del menu

**Output:** Fullsite configurado con datos del restaurante. Diff report limpio.

**Responsable:** implementador.

**Criterio de salida:** Migration Diff Report muestra 0 diferencias criticas.

---

## Fase 6 — Configuracion

**Objetivo:** configurar Fullsite para la operacion especifica del restaurante.

**Inputs:**
- Datos migrados
- Informacion de estaciones de impresion

**Checklist:**
- [ ] Configurar routing de estaciones (cocina, barra, caja, etc.)
- [ ] Configurar printers.json con IPs reales
- [ ] Configurar datos fiscales para facturacion
- [ ] Activar cuenta Facturama (si aplica)
- [ ] Configurar horarios (si aplica)
- [ ] Configurar permisos por rol
- [ ] Verificar que cada item rutea a la estacion correcta
- [ ] Probar timbrado CFDI en sandbox

**Output:** sistema configurado y listo para instalar.

**Responsable:** implementador.

**Criterio de salida:** todas las configuraciones verificadas sin errores.

---

## Fase 7 — Instalacion

**Objetivo:** instalar Fullsite en el hardware del restaurante.

**Inputs:**
- Hardware auditado (fase 4)
- Sistema configurado (fase 6)
- Kit de implementacion (USB con bridge, NSSM, printers.json)

**Checklist:**
- [ ] Instalar print bridge en terminal
- [ ] Instalar NSSM (autoarranque del bridge)
- [ ] Verificar 5 criterios del bridge: imprime, autoarranque, sobrevive reinicio, auto-restart, zero-touch
- [ ] Configurar impresoras (IPs, colas Windows)
- [ ] Test de impresion: cocina, barra, caja, ticket
- [ ] Test de cajon de dinero
- [ ] Instalar PWA en terminal (fullscreen, kiosk)
- [ ] Configurar KDS en monitor de cocina
- [ ] Test offline (desconectar WiFi, crear orden, reconectar)
- [ ] Configurar Chrome: desactivar auto-update, no restaurar pestanas
- [ ] Configurar Windows: desactivar reinicio automatico por updates
- [ ] Verificar UPS (si existe)

**Output:** sistema funcionando en hardware real.

**Responsable:** implementador.

**Criterio de salida:** todos los tests pasan. Bridge certificado (5 criterios).

---

## Fase 8 — Capacitacion

**Objetivo:** que el staff pueda operar Fullsite sin ayuda.

**Inputs:**
- Sistema instalado y funcionando

**Checklist por rol:**

Meseros:
- [ ] Login con PIN
- [ ] Abrir mesa
- [ ] Agregar items (buscar, categorias, modificadores)
- [ ] Sillas y tiempos
- [ ] Enviar a cocina
- [ ] Cobrar (efectivo, tarjeta)
- [ ] Que hacer si no hay internet
- [ ] Que hacer si la impresora falla

Cajero:
- [ ] Todo lo de meseros +
- [ ] Cobro mixto y propina
- [ ] Descuento con PIN gerente
- [ ] Abrir/cerrar turno
- [ ] Corte de caja

Cocina:
- [ ] Ver ordenes en KDS
- [ ] Avanzar status
- [ ] Notificacion sonora

Gerente:
- [ ] Descuentos y cancelaciones con PIN
- [ ] Reapertura de orden
- [ ] Retiros y depositos
- [ ] Corte completo con arqueo

General:
- [ ] Que hacer si no hay internet
- [ ] Que hacer si la impresora falla
- [ ] A quien llamar si algo no funciona

**Output:** staff capaz de operar un turno completo.

**Responsable:** implementador + gerente del restaurante.

**Criterio de salida:** cada rol completo al menos 1 flujo de practica sin ayuda.

---

## Fase 9 — Shadow Day

**Objetivo:** operar un turno completo con Fullsite. POS anterior como respaldo.

**Inputs:**
- Sistema instalado, staff capacitado
- POS anterior disponible como fallback

**Checklist:**
- [ ] Daniel (o implementador) presente en el restaurante
- [ ] Todas las ordenes en Fullsite
- [ ] POS anterior solo se abre si Fullsite falla y no se resuelve en <5 min
- [ ] Documentar cada incidente (hora, mesa, problema, resolucion, tiempo)
- [ ] Documentar cada pregunta del staff
- [ ] Documentar cada vez que se abrio el POS anterior

**Metricas a capturar:**
- Tiempo de primera orden
- Ordenes por hora vs historico
- Veces que se abrio POS anterior
- Preguntas del staff (lista)
- Errores del sistema (screenshots)
- Tiempo de resolucion por incidente
- Cuadre de caja

**Output:** reporte del Shadow Day con metricas + incidentes.

**Responsable:** implementador.

**Criterio de salida:**
- POS anterior se abrio 0 veces
- Ningun incidente duro mas de 5 minutos
- Staff no pide regresar
- Caja cuadra

---

## Fase 10 — Cutover

**Objetivo:** apagar el POS anterior. Fullsite es el unico sistema.

**Inputs:**
- Shadow Day exitoso (fase 9)
- GO/NO-GO aprobado

**Checklist de apertura del dia D:**
- [ ] Bridge corriendo (verificar health)
- [ ] Impresoras encendidas y con papel
- [ ] WiFi estable (speed test rapido)
- [ ] Abrir turno con fondo
- [ ] POS anterior cerrado pero no desinstalado
- [ ] Implementador disponible por telefono/remoto

**Runbook de contingencia durante el dia:**
- Impresora falla: verificar, reiniciar servicio, reintentar
- Internet se cae: POS sigue offline, no recargar
- PIN no funciona: crear temporal via admin
- Staff pide regresar: escuchar, resolver, no forzar. Rollback si es masivo
- Bug critico: documentar, resolver o rollback parcial (esa mesa en POS anterior)

**Output:** restaurante operando con Fullsite como unico sistema.

**Responsable:** implementador + gerente.

**Criterio de salida:** turno completo operado sin POS anterior.

---

## Fase 11 — Hypercare (dias 1-7)

**Objetivo:** soporte intensivo la primera semana.

**Inputs:**
- Cutover completado

**Checklist diario:**
- [ ] Verificar con gerente: algun problema ayer?
- [ ] Revisar audit log para anomalias
- [ ] Revisar sync queue para items pendientes
- [ ] Verificar que el corte del dia anterior cuadro
- [ ] Responder cualquier duda del staff en <30 min

**Canal de soporte:** WhatsApp directo con implementador.
**SLA:** respuesta en <30 min durante horario de operacion.
**Escala:** si el implementador no puede resolver en 1 hora, escala a fundador.

**Output:** 7 dias de operacion estable documentados.

**Responsable:** implementador.

**Criterio de salida:** 7 dias sin incidentes que requieran rollback.

---

## Fase 12 — Cierre de implementacion

**Objetivo:** documentar la implementacion y cerrar formalmente.

**Inputs:**
- 7 dias de hypercare sin incidentes criticos

**Checklist:**
- [ ] Post-Implementation Report completo
- [ ] Lecciones aprendidas documentadas
- [ ] Runbooks de apertura/cierre impresos y en la terminal
- [ ] Contacto de soporte definido para el restaurante
- [ ] POS anterior desinstalado (o decision de mantener 2 semanas mas)
- [ ] Datos de hardware archivados (IPs, modelos, fotos)
- [ ] Migration Diff Report archivado

**Output:** carpeta del cliente completa y cerrada.

**Responsable:** implementador.

**Criterio de salida:** toda la documentacion esta archivada.

---

## Fase 13 — Success Review (dia 30)

**Objetivo:** evaluar si la implementacion fue exitosa y capturar feedback.

**Inputs:**
- 30 dias de operacion

**Checklist:**
- [ ] Reunion con gerente/dueno (30 min)
- [ ] Preguntar: volverian a Wansoft? (la pregunta definitiva)
- [ ] Que funciona mejor que antes?
- [ ] Que extranan del sistema anterior?
- [ ] Que mejorarian de Fullsite?
- [ ] Revisar metricas: ordenes/dia, ticket promedio, incidentes
- [ ] Solicitar testimonio / caso de estudio (si es positivo)
- [ ] Identificar oportunidades de upsell (mas terminales, delivery, etc.)

**Output:** Success Report + testimonio + feedback de producto.

**Responsable:** fundador o account manager.

**Criterio de salida:** el restaurante opera estable y no quiere regresar.

---

## Kit de implementacion (USB)

Preparar para cada instalacion:

- [ ] fullsite-print-bridge.exe (ultima version)
- [ ] nssm.exe
- [ ] printers.example.json
- [ ] raw-print.ps1
- [ ] Runbook de apertura diaria (PDF imprimible)
- [ ] Runbook de cierre diario (PDF imprimible)
- [ ] Runbook "que hacer si..." (PDF imprimible)
- [ ] Este documento (DEPLOYMENT-SYSTEM.md)

---

## Metricas del sistema de implementacion

Rastrear por restaurante:

| Metrica | Target R1 | Target R5 | Target R10 |
|---|---|---|---|
| Dias de implementacion total | 5-7 | 3-4 | 2 |
| Horas de visita in situ | 4-6 | 3-4 | 2 |
| Horas de capacitacion | 3 | 2 | 1 |
| Incidentes en Shadow Day | <3 | <2 | 0 |
| Dias hasta operacion estable | 7 | 5 | 3 |
| Rollbacks | 0 | 0 | 0 |
| NPS del restaurante (dia 30) | 8+ | 9+ | 9+ |
