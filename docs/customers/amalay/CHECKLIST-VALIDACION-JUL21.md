# Checklist Validación Operativa AMALAY — 21 julio 2026 (noche)

## Objetivo
Confirmar que los cambios de multi-tenancy e inventario no afectaron la operación normal.

## POS Básico
- [ ] Login con PIN funciona
- [ ] Turno se abre correctamente
- [ ] Menú carga completo (todas las categorías)
- [ ] Se puede crear una orden nueva
- [ ] Meseros aparecen en el dropdown
- [ ] Mesa se asigna correctamente

## Envío a Cocina
- [ ] "Enviar a cocina" funciona
- [ ] Comanda se imprime en la estación correcta
- [ ] **NUEVO: Verificar que el stock de un ingrediente bajó después de enviar**
  - Antes: ve a /inventario y anota stock de PECHUGA DE POLLO
  - Envía una orden con un platillo que lleve pechuga
  - Después: verifica que el stock bajó

## Pagos
- [ ] Pago en efectivo funciona
- [ ] Pago con tarjeta funciona
- [ ] Ticket se imprime correctamente
- [ ] **QR de factura aparece en el ticket** (verificar que muestra URL completa, no truncada)

## Cancelaciones
- [ ] Cancelar un item pide PIN de gerente
- [ ] **NUEVO: Si el item fue enviado, verificar que el stock se revierte**

## KDS (Cocina)
- [ ] Pantalla de cocina muestra órdenes
- [ ] Se pueden marcar items como listos

## Inventario (Dashboard)
- [ ] /inventario muestra 981 productos con stock real
- [ ] Buscar un producto muestra stock correcto
- [ ] Si hiciste la prueba de deducción, el stock refleja los cambios

## Chat IA
- [ ] Abrir chat y preguntar "cómo vamos hoy"
- [ ] Verificar que la respuesta menciona "AMALAY" (no otro nombre)
- [ ] Datos de ventas son correctos

## Merma (si hay tiempo)
- [ ] Registrar una merma desde Inv. Auditoría → Merma
- [ ] Verificar que el stock bajó en /inventario

## Notas de la Validación
Escribir aquí cualquier comportamiento inesperado:

_______________________________________________________

_______________________________________________________

_______________________________________________________

Fecha/hora: ___________  Validado por: ___________
