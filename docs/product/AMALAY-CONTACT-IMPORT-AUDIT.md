# Auditoría de importación — Amalay

Fecha: 12 de septiembre de 2026.

Este documento contiene solo conteos; no copia nombres, teléfonos ni correos.

## Excel de clientes

- Filas de clientes: 12,195.
- Filas con teléfono normalizable: 11,885.
- Teléfonos únicos: 11,484.
- Duplicados por teléfono: 401.
- Correos únicos válidos: 9,165.
- Clientes con fecha de última visita: 11,455.
- Distribución de visitas: 7,623 sin visita, 4,301 con una visita y 271 con dos o más.
- El campo `Gasto total` no aporta importes positivos en este archivo; no debe usarse para atribución financiera.

## vCard

- Tarjetas de contacto: 2,342.
- Entradas telefónicas normalizables: 3,133.
- Teléfonos únicos: 2,234.
- Entradas repetidas dentro de la agenda: 899.

## Consolidado

- Teléfonos compartidos entre Excel y vCard: 838.
- Solo en vCard: 1,396.
- Solo en Excel: 10,646.
- Audiencia combinada máxima después de normalizar y deduplicar: **12,880 teléfonos únicos**.

## Regla de activación

Tener un teléfono en estos archivos no demuestra consentimiento para mensajes promocionales. Todos los contactos se importan con `optin-pendiente`; el envío por WhatsApp requiere un registro separado con fecha, fuente y operador que confirmó la autorización.
