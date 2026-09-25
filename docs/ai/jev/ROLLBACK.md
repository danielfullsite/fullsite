# Rollback — capa de decisión Jev (Fase 0)

La capa no está desplegada, no tiene consumidores, no escribe en Supabase, no tiene
migraciones ni variables de entorno en Vercel. Por eso el rollback es corto.

## Apagar sin tocar código (inmediato)

`JEV_SHADOW_ENABLED` ausente o distinto de `1` → el adaptador devuelve `jev_disabled` sin
abrir red. Es el estado por defecto.

## Revertir el código

Todo el cambio vive en archivos nuevos:

```
dashboard-app/src/lib/jev/**
dashboard-app/src/__tests__/jev/**
dashboard-app/vitest.jev-eval.config.ts
docs/ai/jev/**
```

Si ya está en `main`, revertir el commit de merge con `git revert`. No hay archivos
existentes modificados que restaurar.

## Credencial

Si hubiera sospecha de exposición: rotar `AI_GATEWAY_API_KEY` en Vercel → AI Gateway → API
Keys, y actualizar la entrada del Keychain que lee `~/.zshrc`. La capa no almacena copia.

## Auditoría local

Los `.jsonl` de auditoría (y su ancla `.jsonl.head`) generados por el runner quedan en `docs/ai/jev/reports/`. Son
evidencia: no se borran en un rollback; se archivan.

## Comprobado

- 2026-09-25: el apagado por defecto está cubierto por `adapter.test.ts` › "apagado por
  defecto: no toca la red" y `engine.test.ts` › "Jev apagado".
- El revert de archivos nuevos no se ejecutó sobre `main` (no se ha mergeado).
