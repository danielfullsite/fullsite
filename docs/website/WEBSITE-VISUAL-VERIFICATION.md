# Website Visual Verification Checklist

**Branch:** `credibility-pass-aug2026`
**Fecha de preparación:** 2026-08-05
**Quién verifica:** Daniel Ramonfaur (fundador) antes de merge a main

---

## Instrucciones

Para verificar localmente antes de deploy:

```bash
cd fullsite-web
python3 -m http.server 8080
# Abrir http://localhost:8080
```

---

## index.html — Checklist de verificación

### General
- [ ] La página carga sin errores de consola (F12 → Console)
- [ ] El CSS no cambió visualmente: colores, tipografía, espaciados idénticos al original
- [ ] La animación de scroll (`reveal`) funciona correctamente
- [ ] El navbar es sticky y funciona el blur al hacer scroll

### Hero
- [ ] Eyebrow: "Software operativo para restaurantes"
- [ ] H1: "Deja de enterarte al cierre."
- [ ] Sub: texto actualizado (sin "fraude", sin "hardware propietario")
- [ ] CTA primario: "Agenda una demo" → navega a `/demo.html`
- [ ] CTA secundario: "Habla por WhatsApp" → abre WhatsApp con número `528115324371`
- [ ] Texto social proof visible debajo de los botones

### Feature 1
- [ ] Tag: "Operación conectada"
- [ ] Sin menciones a "Uber Eats" ni "Rappi" en los bullets

### Feature 2
- [ ] Tag: "Inteligencia operativa"
- [ ] Sin mención a "fraude" en ningún bullet

### Stats
- [ ] "$72M+" con label "en ventas históricas analizadas *"
- [ ] "883" con label "días de historial operacional integrado"
- [ ] Nota de pie "*" visible debajo del grid

### Integraciones
- [ ] Solo 3 logos visibles: WhatsApp (Activo), Mercado Pago (Próximamente), SAT (Próximamente)
- [ ] Sin logos de Uber Eats, Rappi ni DiDi
- [ ] Heading: "Conectado con herramientas clave de tu operación"

### Benefit cards
- [ ] Card "Cancelaciones y excepciones" (no "Detección de fraude")
- [ ] Badge "En desarrollo" visible en card "Predicción de ventas"
- [ ] Card "Inventario teórico" (no "Inventario automático")
- [ ] Card "Rentabilidad por producto" (no "Ingeniería de menú: Qué platillos quitar")

### CTA section
- [ ] Heading: "Deja de descubrir problemas cuando ya te costaron dinero."
- [ ] Sub: texto actualizado (sin "48 horas", sin "60 días de garantía")
- [ ] CTA primario: "Agenda una demo" → `/demo.html`

### FAQ
- [ ] Ninguna respuesta menciona "48 horas" ni "24 horas" como tiempo garantizado
- [ ] Ninguna respuesta menciona "60 días de garantía" ni "devolvemos el setup"
- [ ] Ninguna respuesta dice "nunca se equivoca"

### Footer
- [ ] Link "Demo" visible → `/demo.html`

---

## demo.html — Checklist de verificación

### General
- [ ] La página carga en http://localhost:8080/demo.html sin errores
- [ ] El diseño coincide con index.html (blanco, Inter, verde #10b981, mismo navbar)
- [ ] Mobile (< 900px): columna izquierda aparece encima del calendario

### Layout desktop
- [ ] Dos columnas visibles: descripción izquierda, calendario derecho
- [ ] La columna derecha tiene fondo gris sutil con borde izquierdo

### Contenido izquierdo
- [ ] Eyebrow: "Demo con el fundador · 30 min"
- [ ] H1: "Evaluamos juntos si Fullsite conecta con tu operación."
- [ ] 4 bullets con checks verdes
- [ ] Bloque de quote (sin nombre de cliente específico)
- [ ] Fila con avatar "D" + "Daniel Ramonfaur · Fundador · Fullsite"

### Calendario (Cal.com)
- [ ] Spinner de carga visible inicialmente
- [ ] Si Cal.com NO está configurado: el spinner se reemplaza por mensaje de error y aparece el fallback de WhatsApp (esperar ~8 segundos)
- [ ] Si Cal.com SÍ está configurado: calendario inline visible en columna derecha

### IMPORTANTE — antes de activar Cal.com
- [ ] Reemplazar `"daniel-fullsite/demo"` en el script por el slug real
- [ ] Verificar que el evento de Cal.com tiene las preguntas de lead capture correctas
- [ ] Verificar que Google Calendar está conectado y la disponibilidad es correcta

---

## Aprobación

| Paso | Estado | Fecha |
|---|---|---|
| Verificación visual index.html | PENDIENTE | — |
| Verificación visual demo.html | PENDIENTE | — |
| Configuración Cal.com | PENDIENTE | — |
| Aprobación del fundador | PENDIENTE | — |
| Merge a main y deploy | PENDIENTE | — |

**No hacer deploy sin completar esta tabla.**
