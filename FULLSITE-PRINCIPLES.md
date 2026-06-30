# FULLSITE PRINCIPLES

> Estos principios no son aspiracionales. Son restricciones.
> Cada decision de producto, arquitectura, y operacion debe
> respetarlos. Si un cambio viola un principio, no se hace.
>
> Fullsite no es un POS. Es un Restaurant Operating System.

---

## 1. Nunca perder una orden

Una orden creada por un mesero debe llegar a cocina y a caja.
Sin importar si hay internet, si la impresora falla, si el
sistema se reinicia, o si la terminal se apaga.

La orden se guarda antes de imprimirse. Si la impresion falla,
entra a una cola de retry. Si el internet se cae, se guarda
local y se sincroniza al reconectar. Si el sistema se reinicia,
la orden esta en la nube.

Cero ordenes perdidas. Sin excepciones.

## 2. Nunca emitir una factura incorrecta

Cada factura CFDI debe reflejar exactamente lo que el cliente
consumio y pago. IVA, IEPS, descuentos, propinas — todo debe
cuadrar al centavo.

Si no podemos garantizar que la factura es correcta, no la
emitimos. Es preferible facturar manualmente que emitir un
CFDI con errores fiscales.

## 3. Nunca cerrar caja sin auditoria

Cada turno tiene apertura, operacion, y cierre. El cierre
requiere conteo fisico, autorizacion de gerente, y registro
inmutable de la diferencia.

No existe "cerrar y ya." Existe "cerrar, documentar, y firmar."

## 4. Todo cambio importante es trazable

Quien lo hizo. Cuando. Desde donde. Que cambio. Que habia antes.
Por que. Quien lo aprobo.

Cancelaciones, descuentos, cortesias, reimpresiones, retiros,
reaperturas — cada uno con actor, razon, y aprobador en un
log inmutable que no se puede borrar ni editar.

## 5. Toda integracion tiene fallback

Si el bridge falla, la cola de impresion reintenta.
Si Facturama no responde, se puede facturar despues.
Si la terminal bancaria no funciona, se cobra en efectivo.
Si el internet se cae, el POS sigue operando offline.

Ninguna integracion externa puede detener la operacion
del restaurante.

## 6. Offline primero

El restaurante debe poder tomar ordenes, enviar a cocina,
cobrar, e imprimir tickets sin internet. La sincronizacion
pasa cuando el internet regresa, no cuando el internet existe.

En Mexico, el internet se cae. Fullsite no pierde ventas.

## 7. El restaurante siempre debe poder seguir operando

Si algo falla — bridge, impresora, internet, base de datos,
terminal — el restaurante no se detiene. Hay fallback para
todo. La peor version de Fullsite (todo fallando) sigue
siendo operable.

Si alguna vez un fallo de Fullsite detiene la operacion de
un restaurante, ese es un bug P0 que se resuelve antes que
cualquier feature.

## 8. Los datos financieros cuadran siempre

Ventas del POS = Corte de caja = Terminal bancaria = Reporte.
Fondo + ventas efectivo + depositos - retiros = efectivo esperado.
Efectivo esperado vs declarado = diferencia documentada.

Si algo no cuadra, es un bug. No es "una pequeña diferencia."

## 9. La seguridad es por defecto, no por configuracion

PINs para acciones sensibles. Permisos por rol. Datos cifrados
en transito. Audit log inmutable. RLS en base de datos.

Ningun empleado puede hacer algo que su rol no permite.
Ningun dispositivo en la red puede operar sin autenticacion.
Ningun dato sensible viaja sin cifrar.

## 10. La terminal es desechable, los datos son eternos

Si una terminal se rompe, se moja, se roba, o se apaga
para siempre, el restaurante abre otra terminal (cualquier
tablet con browser) y sigue operando en 2 minutos.

Los datos viven en la nube. La terminal es solo una ventana.

## 11. Cada feature debe pasar la prueba del viernes a las 8pm

Antes de implementar algo, preguntarse: esto funciona cuando
hay 30 mesas ocupadas, 3 meseros corriendo, cocina al maximo,
y el gerente atendiendo una queja?

Si la respuesta es "probablemente" o "no se," no esta listo.

## 12. Las deducciones de inventario son idempotentes

Enviar la misma orden dos veces nunca produce una segunda
deduccion. Cancelar y reabrir no duplica ni pierde stock.
Cada operacion de inventario es un delta sobre el estado
actual, no un valor absoluto que sobreescribe.

Si el sistema no puede garantizar idempotencia, es preferible
no descontar que descontar de mas. El conteo fisico corrige;
el stock fantasma confunde.

## 13. La receta es la unidad fundamental del negocio

El POS no es el centro del Restaurant Operating System. La receta
lo es. Todo se deriva de ella: ingredientes, proveedores, costos,
inventario, produccion, food cost, disponibilidad, compras, y
rentabilidad.

La pregunta correcta nunca es "cuantos kilos quedan." La pregunta
correcta es "cuantos platillos puedo vender antes de quedarme sin
inventario."

## 14. No copiamos. Aprendemos y superamos.

Wansoft opero restaurantes 20 anos. Respetamos eso. Estudiamos
su modelo de datos, sus 822 stored procedures, sus 47 formatos
de impresion, y sus decisiones de diseno.

Pero no copiamos su arquitectura, su UX, ni sus limitaciones.
Adoptamos los principios operativos que funcionan. Mejoramos lo
que podemos hacer mejor. Y no replicamos su deuda tecnica.

---

> Estos principios son la constitucion de Fullsite.
> No se negocian por velocidad, por features, ni por clientes.
> Si algun dia tenemos que elegir entre un principio y un deadline,
> el principio gana.
>
> Fullsite — Restaurant Operating System
