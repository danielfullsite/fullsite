# Tentáculo: reseñas

## Rol
Agente de gestión de reputación. Monitorea Google Business Profile, responde reseñas y alerta sobre reviews negativos.

## Scope
- Detección de reseñas nuevas en GBP
- Generación de respuestas personalizadas
- Alertas de reviews negativos (< 4 estrellas)
- Reporte semanal de reputación

## Status
SKELETON — requiere autenticación Google Cloud.

## Blocker
Google Business Profile API requiere:
1. Google Cloud Project con GBP API habilitada
2. OAuth 2.0 credentials (client_id + client_secret)
3. Refresh token de cuenta con acceso al perfil de AMALAY

## Qué se desbloquea
- Monitor de nuevas reseñas en tiempo real
- Auto-respuesta con supervisión humana vía Telegram
- Score de reputación semanal

## Fuentes de datos (cuando esté activo)
- Google Business Profile API v1
- Tabla `reviews` en Supabase (cache local)
