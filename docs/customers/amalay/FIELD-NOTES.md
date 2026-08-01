# FIELD NOTES — Fullsite

> Evidencia del mercado. Sin interpretar. Solo registrar.
> Cada interacción con un restaurante se documenta aquí.
> Este documento es la fuente de verdad para decisiones de producto, ventas y onboarding.

---

## Formato

```
### [FECHA] — [RESTAURANTE] — [TIPO: venta/demo/implementación/soporte/pérdida]

**Contacto:** Nombre, rol
**Contexto:** Qué pasó

**Objeciones textuales:**
- "..."

**Bugs/confusiones:**
- ...

**Features solicitados:**
- ...

**Decisión:** Compró / No compró / Pendiente
**Por qué:** ...

**Aprendizaje:** ...
```

---

## Registro

### 2026-07-07 — AMALAY — Implementación

**Contacto:** Eduardo Ezquivel, gerente operativo
**Contexto:** Instalación de 3 terminales Electron, bridge de impresión, huella digital

**Frases textuales:**
- "Ha que fregón"
- "Si ya todas las mejoras las haces sobre la app puede ser cualquier día a cualquier hora"
- "Es un gorro pero la idea es que una vez implementado un negocio no tengamos que aparecer por ningún motivo"
- "Si no hay comanda, no te hago nada" (regla de cocina)
- "Si encuentran una rendijita, se agarran y hacen todo lo que se les ocurra" (sobre seguridad)

**Bugs/confusiones:**
- Scroll no funcionaba en sub-páginas (overflow:hidden) — arreglado
- Auditoría 404 por acento en URL — arreglado
- Fullscreen forzado en Chrome molesto — arreglado
- Pre-cuenta imprimió en cocina en vez de caja (IP incorrecta) — arreglado

**Features solicitados:**
- Modificadores por nivel escalonado (pidió 2 veces) — construido
- Crear usuarios desde POS — construido
- Turno obligatorio — construido
- Colores por grupo en categorías — pendiente
- Simplificar header — pendiente

**Decisión:** Piloto activo
**Por qué:** Familia de Daniel, primer cliente

**Aprendizaje:** La impresión es sagrada. Un solo fallo de comanda puede perder la confianza del equipo de cocina.

---

### 2026-07-08 — Prospecto anónimo (via Eduardo) — Pérdida

**Contacto:** Desconocido, dueño
**Contexto:** Eduardo mencionó un restaurante que tenía contrato con otro POS

**Objeciones textuales:**
- "Tengo contrato hasta 2028"

**Decisión:** No compró
**Por qué:** Amarrado a contrato existente

**Aprendizaje:** Los contratos de 12-24 meses son barrera real. Identificar fecha de vencimiento como dato clave en el primer contacto.

---

### 2026-07-09 — Susy González — Mentoría

**Contacto:** Susy González, ex-Wansoft/Parrot, consultora
**Contexto:** Primera reunión de intercambio

**Frases textuales:**
- "Esto de moldearlo para todos está peligroso"
- "Necesitas paquetes"
- "Obsesiónate con los perfiles de restaurantes"
- "Turn saludable es 2% de tu base"
- "No estás perfilando" (por qué Parrot perdía clientes)
- "La barrera no es el restaurantero, es la gente que lo utiliza"

**Contactos ofrecidos:**
- Toño Márquez (menú engineering, mariscos, pide integración de clima)
- Josué Saldaya (consultor de inventarios)

**Aprendizaje:** Perfilar > vender a volumen. El hijo universitario es el usuario real, no el papá. Venta consultiva, no agresiva.

---

*Siguiente entrada: lunes smoke test AMALAY*
