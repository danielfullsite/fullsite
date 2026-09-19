# Piloto WhatsApp CRM — Amalay

Fecha de decisión: 12 de septiembre de 2026.

## Objetivo

Convertir clientes de brunch que ya conocen Amalay en visitas a cena, atribuir cada respuesta, reservación y asistencia, y entregar un reporte mensual de una página con utilidad incremental real.

## Campaña inicial

- Oferta: botella de vino tinto de 375 ml en la próxima cena.
- Disponibilidad: jueves a sábado a partir de las 7:00 p.m.
- Condición: consumo mínimo de $430 MXN por persona.
- Audiencia inicial: contactos del iPhone de Alay y clientes del CRM que hayan autorizado promociones por WhatsApp.
- El mensaje es una plantilla de marketing. Fuera de la ventana de servicio de 24 horas debe enviarse como plantilla aprobada.

## Proveedor recomendado para el piloto

### 1. Twilio — recomendado para empezar

- Permite comprar un número mexicano o registrar un número externo que reciba OTP por SMS o llamada.
- Números en México publicados: local USD 6.25/mes; móvil USD 15/mes.
- WhatsApp: USD 0.005 por mensaje entrante o saliente, más la tarifa de plantilla de Meta.
- Tiene sandbox, onboarding guiado y una API madura.
- Para no interrumpir el WhatsApp Business actual, usar un número nuevo dedicado al Concierge.

Fuentes: [precios de WhatsApp](https://www.twilio.com/en-us/whatsapp/pricing), [precios de números en México](https://www.twilio.com/en-us/voice/pricing/mx), [registro de remitentes](https://www.twilio.com/docs/whatsapp/register-senders-using-api).

### 2. Meta Cloud API directa — siguiente etapa

- Menor costo de plataforma porque no agrega el cargo por mensaje de Twilio.
- Requiere que Fullsite mantenga onboarding, tokens, webhooks, plantillas, reintentos y soporte con Meta.
- Es la mejor ruta cuando Fullsite replique el producto para varios restaurantes.

Fuente: [colección oficial de Meta para Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

### 3. 360dialog — no recomendado para este piloto

- Regular: EUR 49 por número al mes más tarifas de Meta.
- Premium: EUR 99 por número al mes más tarifas de Meta.
- Conviene si se necesita soporte especializado con Meta o si Fullsite decide operar como partner; para un solo número piloto el fijo es innecesario.

Fuente: [precios oficiales de 360dialog](https://360dialog.com/pricing).

## Requisitos para activar producción

1. Comprar un número nuevo mexicano dedicado a `Amalay Concierge`.
2. Confirmar acceso al Meta Business Portfolio de Amalay y completar verificación del negocio.
3. Crear o vincular la WABA y verificar el número por OTP.
4. Aprobar la plantilla de marketing de la campaña de cenas.
5. Registrar evidencia de consentimiento antes de habilitar el envío a un contacto.
6. Configurar credenciales y webhook como secretos del hosting; nunca en el navegador ni en Git.
7. Probar con números internos, después con 25–50 contactos, y vigilar calidad, bloqueos y bajas.

Variables server-side requeridas en el hosting:

```text
WHATSAPP_SENDING_ENABLED=false
WHATSAPP_AUTOMATION_ENABLED=false
WHATSAPP_AI_ENABLED=false
WHATSAPP_AI_MODEL=openai/gpt-5.4-mini
AI_GATEWAY_API_KEY=...
CRON_SECRET=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=+52...
TWILIO_AMALAY_CONTENT_SID=HX...
TWILIO_WHATSAPP_WEBHOOK_URL=https://dashboard.fullsite.mx/api/crm/whatsapp/webhook
TWILIO_WHATSAPP_CLIENT_ID=amalay
```

Las tres banderas deben permanecer en `false` hasta completar la migración, probar el webhook y aprobar la plantilla y el agente desde el CRM.

## Operación autónoma con límites duros

- El agente solo responde automáticamente cuando `WHATSAPP_AI_ENABLED=true`, el proveedor está habilitado y un gerente aprobó el agente en el CRM.
- Antes de cada salida, una función transaccional reserva capacidad en tres cubetas: minuto, día y mes. Los máximos absolutos de aplicación son 20/minuto, 250/día y 5,000/mes; la configuración normal de Amalay empieza en 5/minuto, 80/día y 1,500/mes.
- Dos procesos concurrentes no pueden rebasar el presupuesto porque la reserva usa un bloqueo transaccional por restaurante.
- Los intentos fallidos consumen capacidad de manera conservadora; esto prioriza nunca exceder el límite sobre maximizar volumen.
- Bajas se procesan de forma determinista. Alergias, cobros, reembolsos, quejas y solicitudes de una persona pasan a revisión humana.
- La IA puede reunir nombre, fecha, hora y comensales, pero no confirma disponibilidad por sí sola. Genera una solicitud pendiente para el equipo.
- Cada decisión de IA conserva modelo, intención, confianza, respuesta, motivo de escalación y consumo de tokens.
- El centro operativo del CRM muestra respuestas, escalaciones, alertas y consumo de cuota, y se actualiza cada minuto.

## Embudo y economía mensual

El primer modelo, tomado del brief, usa:

- 1,000 contactos.
- 150 respuestas.
- 40 reservaciones.
- 25 personas sentadas.
- Ticket promedio de $480.
- Costo de comida de 30%.
- Fee mensual de $1,500.
- Fee total por personas sentadas de $320.
- Cuatro botellas de cortesía a $160.33 cada una.

Resultado esperado del modelo: $12,000 en ventas, $6,061.32 de costo total, $5,938.68 de utilidad incremental, 49.5% de margen y 2.41x de ROI sobre la inversión de campaña. El dashboard permite editar cada supuesto y recalcula todo.

## Importación de contactos

La web no debe extraer silenciosamente la agenda del iPhone. El flujo seguro es:

1. En Contactos de Apple, exportar la lista como vCard (`.vcf`).
2. En CRM → Reactivación, seleccionar **Importar contactos**.
3. Fullsite normaliza y deduplica teléfonos antes de mostrar cuántos son nuevos.
4. Al confirmar, se guardan con las etiquetas `brunch`, `iphone-alay` y `optin-pendiente`.
5. WhatsApp solo se habilita después de registrar consentimiento.

## Lo ya implementado

- Importador vCard y CSV con normalización mexicana y deduplicación.
- Mensaje de campaña de cenas basado en el copy aprobado.
- Segmentación por última visita.
- Control de consentimiento antes de abrir WhatsApp.
- Reporte mensual imprimible/guardable como PDF con embudo, costos, utilidad, margen y ROI.
- Webhook entrante con verificación de firma, idempotencia, historial y agente de IA estructurado.
- Límites transaccionales por minuto, día y mes, además de interruptores independientes para campañas, IA y proveedor.
- Bandeja de escalaciones y solicitudes de reservación pendientes en la base de datos.
- Centro operativo integrado al CRM para monitoreo continuo.

## Pendiente de un tercero

- Número contratado.
- WABA y negocio verificados por Meta.
- Plantilla aprobada.
- Credenciales de Twilio/Meta.

Sin esos cuatro elementos Fullsite puede preparar contactos y reportes, pero no debe hacer envíos automáticos reales.
