# Guía Cajero / Gerente — Fullsite POS

## Todo lo del mesero, más:

## Descuentos
1. Toca **% Desc** en la barra de herramientas
2. Selecciona tipo: porcentaje, monto fijo, o cortesía
3. Ingresa el valor
4. **Requiere PIN de gerente** para aprobar
5. El descuento aparece en los totales

## Cancelar un platillo
1. Toca el ícono rojo (⊘) junto al platillo
2. Selecciona el motivo:
   - **No se preparó** — se revierte del inventario
   - **Merma** — se preparó pero no se puede servir (se pierde)
   - **Anular** — error operativo
3. **Requiere PIN de gerente**

## Retiro de caja
1. Toca el ícono **$** en la barra de herramientas
2. Selecciona **Retiro**
3. Ingresa monto y motivo (ej. "Pago proveedor leche")
4. **Requiere PIN de gerente**
5. El retiro se resta del esperado en el corte

## Depósito
1. Mismo proceso pero selecciona **Depósito**
2. Se suma al esperado en el corte

## Corte de caja
1. Ve al menú (☰) → **Corte de caja**
2. **Requiere PIN de gerente**
3. El sistema muestra:
   - Fondo inicial
   - Ventas por método (efectivo, tarjeta, etc.)
   - Depósitos y retiros
   - **Esperado** = fondo + ventas efectivo + depósitos - retiros
   - Ingresa el **Declarado** (lo que hay en la caja)
   - **Diferencia** = declarado - esperado
4. Cierra el turno

## Facturación
1. El cliente escanea el QR del ticket
2. Llena sus datos fiscales (RFC, razón social, etc.)
3. La factura se timbra automáticamente

## Auditoría
- Menú → **Auditoria**: historial de todas las acciones (quién, qué, cuándo)
- Menú → **Historial**: órdenes cerradas del día con detalles

## Emergencias
- **Bridge se cae**: doble-click en `start-bridge.bat` en el escritorio
- **Chrome se cierra**: reabrir, ir a `app.fullsite.mx/pos`
- **Internet se cae**: seguir trabajando normal, sync automático al volver
- **Nada funciona**: abrir Wansoft como respaldo, llamar a Daniel
