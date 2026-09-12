# Preflight de token para KDS

La lectura cloud y la escritura del avance de cocina usan `service_role` sólo detrás
de un token HMAC por tenant. Sin este preflight, ambos endpoints fallan cerrado con
`503`; el KDS conserva las comandas recibidas por LAN y su caché local.

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
6. Antes de desplegar el código que exige el token, provisiona el secreto server y
   reconstruye/importa los kits. Así no existe una ventana donde el respaldo cloud
   quede bloqueado por falta de configuración.
7. Antes de operar, comprueba: GET de cocina responde, marcar un producto persiste,
   un request sin token recibe `401`, y con el secreto server ausente GET y PATCH
   reciben `503` sin consultar Supabase. Confirma también que, con WAN caída, una
   comanda nueva sigue llegando por LAN y que al reiniciar aparece desde caché.

No despliegues el PATCH atómico ni la migración KDS pendiente hasta completar los
siete pasos en staging y reconstruir el instalador desde el commit final.
