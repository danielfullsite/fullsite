# JEV system map v1

Version: `fullsite-system-map/0.1.0`

## Propósito

JEV recibe este mapa fijo como contexto de clasificación. No recibe el
repositorio, documentación cruda, datos de clientes, credenciales, pedidos,
mensajes ni estado vivo. Los hechos de cada gate siguen entrando por manifiestos
tipados, con hash y límites explícitos.

## Dominios

| Dominio | Lo que JEV sabe | Lo que JEV no puede hacer |
| --- | --- | --- |
| POS offline | El renderer no es autoridad durable | Cambiar órdenes, cobros o recibos |
| Autoridad durable | Main valida identidad, revisión, catálogo y recuperación | Autorizar una transición P17/P19 |
| KDS | Es una proyección de cocina de sólo lectura | Abrir turno, enviar o cancelar ventas |
| Plataforma | Tenant isolation y roles administran cambios | Consultar bases de datos o cambiar configuración |
| Automatizaciones | Los agentes proponen y requieren dueño humano para efectos | Enviar mensajes, elegir workflows o disparar tareas |
| Release físico | Laboratorio, GUI y cajas físicas son gates distintos | Certificar, desplegar o liberar una Caja |

## Actualización

1. Proponer un cambio como documento de arquitectura, sin secretos ni datos
   operativos.
2. Revisar que cada frase sea estable, comprobable y no autorice acción.
3. Cambiar la versión y el test de `system-context.ts` junto con la revisión.
4. Ejecutar la batería JEV. Un fallo bloquea la nueva versión del mapa.

## Límite de “100%”

El mapa puede estar completo respecto de la arquitectura conocida. Eso no
convierte un estado vivo o validación física en conocimiento automático: esos
hechos sólo entran mediante una evidencia redactada aprobada.

