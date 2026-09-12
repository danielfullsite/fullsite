# Preflight de token para KDS

La escritura del avance de cocina usa `service_role` sólo detrás de un token HMAC
por tenant. Sin este preflight, el endpoint de escritura falla cerrado con `503`.

1. Genera y guarda `KITCHEN_TOKEN_SECRET` en el gestor de secretos. Debe tener al
   menos 16 caracteres; no lo pongas en el manifest ni en Git.
2. Configura el mismo secreto en el entorno server de Dashboard. No lo expongas
   como variable `NEXT_PUBLIC_*`.
3. En una terminal con el secreto cargado en el entorno, valida sin escribir nada:
   `node scripts/deployment-kit/generate-kit.cjs --manifest <manifest.json> --validate-only`.
4. Genera el kit. Cada `config.json` llevará sólo el HMAC derivado
   `kitchen_token`, nunca el secreto maestro. Los checksums del kit permiten
   verificar que el archivo importado es el generado.
5. Importa el `config.json` correspondiente en cada terminal. Electron inyecta
   `pos_kitchen_token` únicamente en el origen propio de Fullsite.
6. Antes de operar, comprueba: GET de cocina responde, marcar un producto persiste,
   un request sin token recibe `401`, y con el secreto server ausente recibe `503`.

No despliegues el PATCH atómico ni la migración KDS pendiente hasta completar los
seis pasos en staging y reconstruir el instalador desde el commit final.
