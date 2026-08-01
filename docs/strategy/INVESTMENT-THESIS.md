# Investment Thesis v1

> **Fecha:** 2026-07-28  
> **Audiencia:** Inversores seed/pre-seed (YC, Dalus, Hi-Ventures)  
> **Regla:** Este documento es la narrativa de inversión. Para la estrategia de negocio interna, ver `COMPANY-BRAIN.md`.

---

## Tesis central

**Los restaurantes independientes en México no tienen un problema de software. Tienen un problema de decisiones.**

Los dueños y gerentes reciben información 24 horas tarde — el reporte del día anterior, la hoja de Excel del contador, el WhatsApp del gerente. Para cuando saben qué pasó, ya no pueden corregirlo.

Fullsite resuelve eso dando información al segundo. No al día siguiente. No en el reporte de las 11pm. Al segundo. Ventas en tiempo real, food cost por platillo, qué mesero está rindiendo, si el inventario de un ingrediente crítico va a acabarse antes del cierre.

La decisión que se toma con información de hace 24 horas vale poco. La misma decisión con información de hace 30 segundos puede salvar el margen del día.

**Nuestra apuesta:** el restaurante que usa Fullsite toma mejores decisiones → genera más revenue → renueva → nos recomienda → genera más clientes. El ciclo de valor empieza en la información, no en el feature.

---

## Los 3 mecanismos de moat

### 1. Switching cost operacional

Un restaurante que usa Fullsite entrena a su equipo en el POS, configura sus recetas, documenta sus procesos, y genera historial de datos. Abandonar Fullsite significa perder ese historial y reentrenar a todos. El switching cost crece con cada mes de uso.

Wansoft lleva 20 años con sus clientes porque el switching cost operacional es enorme. Nosotros construimos el mismo tipo de adhesión, pero con una arquitectura moderna que permite seguir mejorando sin acumular deuda técnica.

### 2. Data network effect (latente)

Cuando tengamos suficientes restaurantes, los datos agreg permiten benchmarks industria: "tu food cost de chilaquiles es 3% más alto que el promedio de restaurantes similares en San Pedro". Ese benchmark es imposible sin escala. Ningún competidor con 10 clientes puede darlo.

Este moat no existe hoy — existe cuando tengamos 50+ restaurantes con datos limpios. Pero la arquitectura multi-tenant lo hace posible desde día 1.

### 3. Distribución B2B via Grupo Galería

El fundador es tercera generación de Grupo Galería (200+ restaurantes en México y Europa). Los primeros clientes llegan via referidos directos en la red familiar y operadores conocidos. Eso da un tiempo de validación sin costo de adquisición que la competencia no puede replicar.

Este canal no es permanente — es el puente para llegar a traction antes de necesitar marketing pagado.

---

## Diagnóstico de la narrativa actual

**Problema con la narrativa "POS inteligente":** en México hay 10+ POS en el mercado. Si Fullsite se presenta como un POS más con IA, pierde contra Wansoft (20 años de marca) y contra Toast (presupuesto de marketing). Nadie necesita otro POS.

**La narrativa correcta:** Fullsite no es un POS. Es la capa de inteligencia operacional que los restaurantes no tenían. El POS es el dispositivo de captura de datos. La plataforma es lo que transforma esos datos en decisiones.

Diferencia práctica:
- Un POS te dice cuánto vendiste ayer.
- Fullsite te dice a las 2pm si vas a cerrar el día arriba o abajo de tu promedio semanal — y qué puedes hacer todavía para cambiarlo.

---

## Condiciones para que la tesis funcione

1. **Los restaurantes adoptan el producto por sí mismos** (no solo porque el dueño lo impone al equipo). Si el mesero lo percibe como burocracia adicional, la adopción falla.

2. **El food cost en tiempo real se convierte en comportamiento** — el gerente reacciona a la alerta de "costo arriba de baseline", no solo la lee. Si la información no cambia comportamiento, no hay valor.

3. **La plataforma escala sin personalización por cliente.** Si cada restaurante nuevo requiere trabajo manual de configuración, el modelo no funciona. FEOS (plataforma multi-tenant, aprovisionamiento automatizado) es la condición técnica.

4. **El canal de distribución via Grupo Galería cierra los primeros 5 clientes.** Con 5 clientes pagando $4,999 MXN/mes, el breakeven de la plataforma está cubierto y la narrativa de inversión tiene prueba de traction.

---

## Métricas que validan la tesis

| Métrica | Target año 1 |
|---|---|
| Clientes activos | 5 restaurantes |
| MRR | $25,000 MXN |
| Churn mensual | < 5% |
| NPS del gerente | > 40 |
| Sesiones/día por terminal | > 8 horas de uso activo |
| Tiempo de onboarding | < 2 horas de capacitación |

---

## Por qué ahora

Wansoft está perdiendo clientes después de su migración a Clip. La infraestructura de la industria está en transición. Los restaurantes están buscando alternativas pero no hay una opción que combine POS moderno + inteligencia operacional + soporte en español + precios accesibles.

Fullsite entra en el momento en que la fricción de cambiar es baja (el sistema que usaban está peor que antes) y la propuesta de valor es alta (información que no tenían antes).

La ventana de oportunidad es 2026-2027. Después de ese período, algún jugador más grande (Toast México, Wansoft rediseñado, o un nuevo entrante con VC) va a saturar el mercado. Necesitamos traction demostrable antes de que eso suceda.
