# Brief para Eduardo — Martes 8 julio 2026

---

## Tu rol el martes

No eres soporte técnico. No eres mesero. No eres cajero.

Eres el observador operativo. Tu trabajo es ver lo que nadie más ve.

Daniel va a estar resolviendo problemas técnicos si surgen.
Tú vas a estar observando cómo opera el restaurante con el nuevo sistema.

---

## Lo que necesitas saber del sistema

### POS (terminal de caja y entrada)

- Se ve como una app web en Chrome (fullscreen)
- Login con PIN de 4 dígitos (tu PIN: 4567, rol: gerente)
- El mesero abre mesa → agrega items → envía a cocina → el cajero cobra
- Meseros solo ven sus mesas. Cajeros ven todas las mesas
- Descuentos y cancelaciones requieren PIN de gerente (tú o Rodrigo)

### KDS (pantalla de cocina)

- Pantalla en la cocina muestra las órdenes que llegan
- 1 click en un item = "preparando" (se pone amarillo)
- 2 clicks = "listo" (desaparece)
- No tiene botón de cancelar — cancelaciones solo desde el POS con PIN gerente
- Si se congela: F5 para refrescar (no pierde datos)

### Cobro

- Efectivo: cajón de dinero abre automáticamente
- Tarjeta: cajón NO abre
- Mixto: cajón abre si incluye efectivo
- 18 métodos de pago configurados (los mismos que Wansoft + Dólares, Cortesía, etc.)

### Corte de turno

- Desde /pos/turno
- Corte X = snapshot sin cerrar
- Cierre = wizard de 4 pasos con denominaciones
- Requiere PIN de gerente para cerrar

---

## Qué observar

### En el staff

- [ ] ¿Entienden el flujo sin que les expliquen?
- [ ] ¿Dónde dudan?
- [ ] ¿Qué botón buscan que no existe?
- [ ] ¿Hacen algo intuitivo que no esperábamos?
- [ ] ¿Están más rápidos o más lentos que con Wansoft?

### En la cocina

- [ ] ¿El chef entiende la pantalla?
- [ ] ¿Usa el 1-click/2-click bien?
- [ ] ¿Las comandas llegan rápido (< 3 seg)?
- [ ] ¿El batch counter ayuda?
- [ ] ¿Se pierde alguna comanda?

### En la caja

- [ ] ¿El corte cuadra al final del día?
- [ ] ¿Las formas de pago están bien agrupadas?
- [ ] ¿El cajero se siente cómodo?
- [ ] ¿Algún cobro problemático?

### En general

- [ ] ¿Alguien pide regresar a Wansoft?
- [ ] ¿Algo que Wansoft hacía mejor?
- [ ] ¿Algo que Fullsite hace mejor?
- [ ] ¿El gerente confía en el sistema?

---

## Frases textuales

Cada vez que alguien diga algo interesante, escríbelo exactamente como lo dijo.

No lo interpretes. No lo resumas. Textual.

Ejemplos de lo que buscamos:
- "¿Y cómo le hago para...?"
- "En Wansoft esto era más fácil porque..."
- "Ah, esto me gusta porque..."
- "¿Y si pudiera...?"

Esas frases construyen el roadmap.

---

## Si algo falla

| Problema | Qué hacer | Tiempo máximo |
|----------|-----------|---------------|
| POS no carga | F5 en Chrome | 30 seg |
| KDS no muestra órdenes | F5 en pantalla cocina | 30 seg |
| Bridge no imprime | Ir al CMD, correr `node bridge.js` | 1 min |
| Impresora no responde | Verificar papel, encendida, red | 2 min |
| Internet se cae | Seguir operando (funciona offline) | Auto-recovery |
| Cajón no abre | Abrir con llave | 30 seg |
| 3+ incidentes en 30 min | Considerar Wansoft para esa mesa/turno | Decisión del gerente |
| TODO FALLA | Abrir Wansoft. No está desinstalado | 30 seg |

---

## Lo más importante

El martes no es un examen. Es Day 0.

El objetivo no es que todo salga perfecto.
El objetivo es aprender lo que no podemos aprender sin operar.

Si algo falla, lo documentamos y lo arreglamos.
Si algo sale bien, lo documentamos y lo replicamos.

Tu experiencia de 20 años en operación de restaurantes es lo que hace que estas observaciones valgan oro. Nadie más en el equipo puede ver lo que tú ves.

---

> Imprimir este documento y tenerlo en mano el martes.
