# Operational Reliability v2

> Guía de confiabilidad operacional de Fullsite para deployments en producción.  
> **Fecha:** 2026-07-28  
> Enterprise theater cortado — este documento es práctico, no aspiracional.

---

## Principio rector

**El gerente es la primera línea de defensa, no el soporte técnico.**

Cuando algo falla en el restaurante (y va a fallar), la secuencia debe ser:
1. El gerente diagnostica y resuelve usando el Manager Panel.
2. Si no puede resolverlo, escala a soporte via WhatsApp con screenshots del Manager Panel.
3. Solo si soporte tampoco puede resolverlo remotamente, se coordina visita presencial.

El objetivo es que el 80% de los problemas operacionales sean resolubles por el gerente sin contactar a soporte.

---

## Human Reliability — qué puede fallar y cómo responder

### Fallos comunes en operación

| Síntoma | Causa más probable | Acción del gerente |
|---|---|---|
| POS no arranca | Electron no cargó | Cerrar y reabrir. Si persiste: F5 en la ventana del Electron |
| Menú no carga | Falta de sync inicial | Verificar que hay conexión al abrir. Si hay conexión y no carga: recargar |
| Ticket no imprime | Bridge desconectado | Verificar que el icono del bridge está activo en bandeja. Reiniciar bridge |
| Orden no llega a cocina | KDS apagado o sin red | Verificar tablet de cocina. Si sigue fallando: modo manual (gritar o llamar) |
| Pago con tarjeta rechazado | Terminal bancaria | Intentar de nuevo. Si falla 2 veces: cobrar en efectivo, documentar |
| Internet caído | ISP | El POS sigue operando offline. Seguir tomando órdenes normalmente |

### Modo degradado (sin internet)

El POS opera completamente offline. El gerente debe saber:
- Las órdenes se guardan localmente.
- Al volver internet, todo sincroniza automáticamente.
- El KDS puede perder conectividad con el POS en modo offline — usar reimpresión de comanda si es necesario.
- El cierre de turno se puede hacer offline y sincroniza al reconectar.

---

## DR — Disaster Recovery

### RTO y RPO

| Escenario | RTO (tiempo de recovery) | RPO (pérdida de datos) |
|---|---|---|
| Internet caído | 0 segundos — POS sigue operando | 0 — datos en IDB local |
| Terminal rota | 5 minutos — abrir nueva terminal en cualquier tablet | 0 — datos en la nube |
| Bridge caído | 2 minutos — reiniciar bridge | 0 — órdenes guardadas, se reimprimen |
| Supabase caído | POS sigue operando offline hasta que regrese | 0 — IDB local es la fuente durante el outage |
| Corrupción de IDB | 30 minutos — restaurar desde sync con la nube | Últimas horas del turno actual |

### Backup

- Los datos financieros están en Supabase (cloud) — backup automático.
- Los datos de sesión activa están en IDB (local) — se sincronizan al conectar.
- No hay paso manual de backup requerido en operación normal.

---

## Manager Panel

El Manager Panel es la herramienta de diagnóstico del gerente. Accesible desde el dashboard en `Configuración → Sistema → Diagnóstico`.

### Lo que muestra

| Métrica | Descripción |
|---|---|
| Estado de conexión | Online / Offline + tiempo desde último sync |
| Cola de sync | Número de eventos pendientes de sincronizar |
| Estado del bridge | Conectado / Desconectado |
| IDB health | Número de registros en cada store |
| Último turno cerrado | Fecha y hash de verificación |
| Agentes activos | Estado de los 5 agentes de AI Ops |

### Acciones disponibles

- **Forzar sync** — sincroniza la cola pendiente inmediatamente
- **Reiniciar bridge** — cierra y reabre la conexión con el bridge de impresión
- **Ver log de errores** — últimas 50 entradas del log del sistema
- **Exportar estado** — genera un archivo JSON del estado del sistema para enviar a soporte

---

## Playbook de instalación — 4 fases

### Fase 1: Preparación (día -7)

1. Confirmar hardware: tablet(s) con Chrome, impresora térmica compatible, cajón de dinero, terminal bancaria.
2. Crear tenant en sandbox: `python onboard_client.py --client-id nombre --confirm-ref jkcnxfbb...`
3. Importar menú desde Wansoft o cargar manualmente.
4. Configurar recetas y precios.
5. Crear cuentas de staff (dueño, gerente, meseros, cocina).

### Fase 2: Shadow Day (día -1)

Un día completo de operación paralela: Wansoft activo + Fullsite activo. El equipo opera Fullsite pero las transacciones reales van en Wansoft. Objetivo: que el equipo conozca el flujo sin riesgo.

**Criterio de paso:** al final del Shadow Day, el gerente puede abrir turno, tomar 10 órdenes, enviar a cocina, y cerrar turno sin ayuda.

### Fase 3: Go-Live (día 0)

1. Cierre final de Wansoft en modo normal.
2. Apertura de turno en Fullsite.
3. Daniel o soporte en sitio las primeras 4 horas.
4. Primera impresión de ticket real.
5. Primer cierre de turno real.

Ver [`playbooks/GO-LIVE.md`](../playbooks/GO-LIVE.md) para el checklist completo.

### Fase 4: Estabilización (semana 1-2)

- Revisión diaria del log de órdenes vs cierre de caja.
- Ajuste de configuración de impresoras según feedback del equipo de cocina.
- Primera sesión de food cost: verificar que las recetas están bien configuradas.
- Al final de la semana 2: R1 validation (ver `certifications/AMALAY-R1-VALIDATION.md`).

---

## Roadmap de confiabilidad

### Now (activo)

- IDB v3 con stores de turnos y cash_movements
- sync_queue con retry automático
- Bridge con reconexión automática
- Manager Panel básico (métricas de estado)

### Next (próximas 4-6 semanas)

- Alertas proactivas: "llevas 20 minutos sin sync" → notificación al gerente
- Backup verificable: hash de IDB que el gerente puede confirmar
- Multi-terminal: 2 terminales en el mismo turno sin conflictos
- Modo de emergencia: operación cash-only con sync diferida

### Later (post-Cliente #2)

- Monitoreo centralizado: vista de estado de todos los restaurantes desde un panel
- Alertas via Telegram para el dueño cuando hay anomalías
- Auto-recovery: el sistema detecta y resuelve problemas comunes sin intervención
