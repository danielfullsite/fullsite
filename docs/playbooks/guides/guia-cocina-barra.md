# Guía Cocina / Barra — Fullsite POS

## Cómo funciona
- Cuando un mesero manda una orden a cocina, **la comanda se imprime automáticamente**
- La comanda dice: mesa, mesero, hora, y los platillos con modificadores
- Cocina recibe los platillos de comida
- Barra recibe las bebidas
- Si hay tiempos, los platillos vienen separados (TIEMPO 1, TIEMPO 2, etc.)

## KDS (pantalla digital) — opcional
1. Abrir Chrome en la pantalla de cocina
2. Ir a `app.fullsite.mx/pos/cocina` (o `/pos/barra` para barra)
3. Las órdenes aparecen en tiempo real
4. Cuando el platillo está listo, toca **Listo**
5. El mesero ve la notificación en su pantalla

## Si la impresora no imprime
1. Verificar que la impresora esté encendida y con papel
2. Verificar que la ventana negra (CMD) del bridge siga abierta
3. Si no está abierta: doble-click en `start-bridge.bat`
4. Si sigue sin imprimir: avisar al gerente
5. **Las órdenes NO se pierden** — la cola de impresión reintenta automáticamente cada 15 segundos

## Importante
- **NUNCA apagues la computadora** durante horario de operación
- **NUNCA cierres la ventana negra (CMD)** — es el puente de impresión
- Si el papel se acaba, cambia el rollo y la siguiente comanda sale automáticamente
