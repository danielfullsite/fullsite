> **ARCHIVED.** Replaced by: `ROADMAP.md`
>
> This document is kept for historical reference only.

# POST-CUTOVER BACKLOG

No implementar hasta que AMALAY opere estable con Fullsite.
Priorizar por impacto en el negocio, no por facilidad.

---

## UX / Diseño

| # | Idea | Impacto | Esfuerzo | Prioridad | Por que |
|---|------|---------|----------|-----------|---------|
| UX-LOGIN-01 | Redisenar login: fondo fotografico oscuro, glassmorphism, mobile-first, premium | 6 | M | P2 | Primera impresion del producto. No bloquea operacion pero afecta percepcion de calidad |
| UX-CIERRE-01 | Modo rapido en cierre de caja: ingresar total directamente sin contar por denominacion | 7 | S | P1 | Reduce tiempo de cierre. Validar con staff si realmente cuentan por denominacion |
| UX-01 | Toast timeout 2.5s → 4-5s | 6 | S | P1 | Mesero no confirma si la orden se envio |
| UX-02 | Split button flex-[0.4] → flex-1 | 5 | S | P2 | Touch target mas chico de la barra |
| UX-06 | Grid de categorias optimizado para tablet landscape | 5 | S | P2 | Texto borroso en tablets |
| UX-08 | Editar/eliminar item con botones visibles (no solo long-press) | 6 | M | P1 | Items eliminados por error |
| UX-10 | Modificadores en 4-5 columnas en tablet | 5 | S | P2 | Wrapping en tablet |
| UX-11 | Toast position bottom-right en vez de top-center | 4 | S | P2 | Feedback facil de perder |
| UX-14 | Mesa cards gap en grid | 4 | S | P2 | Misclicks en tablet |

## Polish / Consistencia

| # | Idea | Impacto | Esfuerzo | Prioridad | Por que |
|---|------|---------|----------|-----------|---------|
| PL-05 | Cash input scroll-into-view cuando keyboard abre en tablet | 6 | S | P1 | Cajero no ve lo que escribe |
| PL-06 | KDS: boton avance status con feedback visual (spinner) | 5 | S | P1 | Chef toca multiples veces pensando que no funciono |
| PL-07 | KDS: transicion suave cuando llegan ordenes nuevas | 4 | M | P2 | Cards saltan de posicion |
| PL-08 | Idle timeout: warning 5 min antes de lockout | 5 | S | P1 | Terminal se bloquea sin aviso |

## KDS (del KDS-V2-BACKLOG.md)

| # | Idea | Impacto | Esfuerzo | Prioridad | Por que |
|---|------|---------|----------|-----------|---------|
| V-01 | Batch counter en header (conteo por platillo) | 9 | M | P1 | Diferenciador. Chef planifica batch sin contar tarjetas |
| V-02 | Ordenar tarjetas por tiempo de espera | 7 | S | P1 | Chef no decide "que hago ahora" — siempre es la de arriba |
| V-04 | Mesa completa indicator (3/3 listos → SERVIR) | 7 | M | P1 | Chef no cuenta platillos manualmente |
| V-06 | Mesa numero a 48-60px | 6 | S | P1 | Legible a 3-5 metros |

## Infraestructura / Navegacion

| # | Idea | Impacto | Esfuerzo | Prioridad | Por que |
|---|------|---------|----------|-----------|---------|
| NAV-01 | Agregar Auditoria y Monitor al menu hamburger del POS | 5 | S | P1 | Gerente no encuentra estas pantallas |
| NAV-02 | Eliminar offline-sync.ts (codigo muerto) | 3 | S | P3 | Limpieza, no afecta operacion |

## Producto / Features

| # | Idea | Impacto | Esfuerzo | Prioridad | Por que |
|---|------|---------|----------|-----------|---------|
| FEAT-01 | Notificacion push/Telegram al hacer retiro de efectivo | 6 | M | P2 | Dueno no se entera de retiros grandes |
| FEAT-02 | Formas de pago faltantes: Dolares, Cortesia, Influencer, etc. | 7 | S | P1 | Decidir cuales agregar basado en uso real |
| FEAT-03 | Cachear recetas offline para deduccion de inventario sin internet | 8 | L | P1 | LIMITACION-OFF-INV-01 documentada |

---

## Reglas

- No implementar nada de esta lista hasta que AMALAY opere estable
- Repriorizar despues de cada semana de operacion con evidencia real
- Si el staff reporta un problema que esta aqui, sube a P0
- Si nadie reporta un problema que esta aqui despues de 30 dias, baja o se elimina
