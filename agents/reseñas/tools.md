# Herramientas disponibles — reseñas

## APIs pendientes (skeleton)
| Tool | Auth requerida | Status |
|---|---|---|
| Google Business Profile API v1 | OAuth 2.0 con refresh_token | pendiente |
| Google My Business Management API | mismo project GCP | pendiente |

## APIs activas (cuando esté activo el tentáculo)
| Tool | Uso |
|---|---|
| Supabase REST (`reviews`) | Cache local de reseñas procesadas |
| Groq llama-3.3-70b | Generación de respuestas personalizadas |
| Telegram Bot | Alertas y aprobación humana |

## Steps de activación
1. Crear proyecto en Google Cloud Console
2. Habilitar "Business Profile Performance API" y "My Business Management API"
3. Crear OAuth 2.0 Client ID (tipo: Desktop o Web App)
4. Generar refresh_token con scope `https://www.googleapis.com/auth/business.manage`
5. Setear secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
6. Activar workflow `gbp-monitor.yml`
