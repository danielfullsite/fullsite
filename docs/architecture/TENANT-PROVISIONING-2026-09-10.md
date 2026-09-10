# Alta reanudable y activación de restaurantes

Candidato de software. Requiere la migración pendiente
`20260910070000_tenant_provisioning_atomic`; no se ha aplicado en producción.
El dominio es `provision-tenant.ts` y la orquestación compartida de las dos rutas
es `onboard-tenant.ts`. El SDK sólo administra identidades Auth. Los datos del
restaurante y las membresías pasan por PostgREST/RPC con service role.

## Orden y recuperación

Auth crea o recupera identidades por email, recorriendo las páginas necesarias.
Un reintento no cambia contraseñas existentes ni el restaurante/rol primario de
un usuario que ya existe. La cuenta de servicio debe pertenecer al restaurante
solicitado; una coincidencia de email con identidad ajena no autoriza adoptarla.

Un restaurante nuevo comienza `active:false, provisioning_state:pending`. El
plan inicial se guarda en `clients.provisioning_plan` dentro del mismo INSERT: mesas,
plantilla resuelta, combos y sucursales con UUID generado en servidor. No contiene
PINs ni contraseñas. Un reintento pendiente usa ese plan aunque cambie la solicitud;
si falta el plan requiere conciliación explícita. Un tenant completo o legacy sólo
verifica readiness: no vuelve a sembrar ni resucita productos eliminados. La siembra inserta
sólo filas ausentes: no restablece precios, impuestos, marca, horarios, empleados,
políticas de receta ni autoridad de inventario. Un error de lectura o un conteo
ambiguo detiene el proceso; no se interpreta como tabla vacía.

Los conflictos de IDs globales se conservan y se comprueba su pertenencia. Una
ubicación de otro restaurante nunca se reasigna; los IDs explícitos se validan
antes de congelar el plan para permitir corregir una solicitud inválida. La migración de identidad de
membresías se detiene si existen duplicados; no los borra automáticamente.

Después de completar el skeleton se registra readiness. La activación vuelve a
comprobar las invariantes, crea/confirma las membresías de dueño y servicio y
activa el restaurante en una sola transacción. Un rol incompatible, usuario
inexistente o skeleton incompleto revierte toda esa transacción. Las rutas no
responden éxito si falla una membresía. Un restaurante suspendido conserva su
estado y no recibe nuevas membresías por esta vía.

## Personal y credenciales

Las plantillas de personal usan PINs aleatorios criptográficos de diez dígitos
y nacen inactivas. Su ID no depende del PIN. Sólo se devuelven PINs de filas
insertadas en esa ejecución; un reintento no presenta un PIN nuevo que nunca se
guardó. Operar requiere configurar personal real. `staff_setup_required` se
calcula desde el estado persistido, incluso después de un reintento sin PINs nuevos
o un rechazo por suspensión. Requiere al menos un empleado activo, con rol de Caja
reconocido y PIN numérico de 4–10 dígitos; una plantilla inactiva no cumple.

Una credencial de servicio recién creada sólo se entrega tras confirmar la
activación. Para un servicio existente se responde `existing_not_returned`, sin
rotarlo de forma implícita ni presentar una contraseña inventada como vigente.
La recuperación segura de una credencial cuya respuesta se perdió todavía
requiere completar su mecanismo de entrega/rotación; no se certifica H11 completo.

## Alcance

La activación acredita skeleton y acceso del dueño; no certifica recetas reales,
impresoras, terminales, integraciones, configuración fiscal ni primera venta del
restaurante. La plantilla inactiva y los pendientes de credenciales se muestran
explícitamente. Las cuentas Auth creadas antes de un fallo pueden permanecer sin
membresía y se recuperan en el siguiente intento.


## Pantallas

`/onboarding` dirige al alta autenticada de `/platform/tenants`. El wizard legacy
escribía primero desde el navegador con credenciales anónimas y después llamaba
un endpoint cuyo secreto no podía tener; ya no existe ese camino de siembra parcial.
La pantalla de resultado valida la confirmación del restaurante y conserva los
datos de la solicitud enviada. Para un dueño existente no muestra ni copia la
contraseña escrita en el formulario como si se hubiera cambiado. Indica personal
pendiente desde el recibo persistido y dirige a Terminales para asignar sucursales.

La selección inicial de AuthContext resuelve el rol para el mismo restaurante
preferido por los metadatos. Sin restaurante preferido, toma restaurante y rol
de una sola membresía real; excluye las membresías de act-as. Un fallo de lectura
no combina el restaurante actual con el rol de otra membresía. Esta selección
del navegador no sustituye la autorización de cada API.
