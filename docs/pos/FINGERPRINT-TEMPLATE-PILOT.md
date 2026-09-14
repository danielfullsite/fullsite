# Piloto: plantillas de huella en POS secundarios

## Decisión de seguridad

No habilitar `fingerprintSyncSecret` ni restaurar `/api/pos/fingerprint`. Ese
diseño usa un bearer global, deja que el cliente declare `client_id`, y mueve la
plantilla biométrica sin cifrado de extremo a extremo. El `401` observado es el
fallo cerrado de una ruta que no existe en esta rama, no una razón para abrirla.

Para el piloto, **Caja es la copia canónica**. Se exporta un bundle cifrado desde
Caja y se importa en cada POS con lector. El renderer, el KDS, Supabase y el
secreto LAN no participan. Después de importar, el lector usa la copia local sin
internet. Enrolar y borrar se hace primero en Caja y luego se repite la copia.

## Prerrequisitos

- PowerShell como administrador.
- Fullsite POS cerrado en origen y destino.
- Caja declara `terminal_role=server_pos`.
- Cada secundaria declara `terminal_role=pos` y tiene lector. Una secundaria que
  todavía diga `server_pos` está mal aprovisionada: corregir el rol antes de
  importar. El script no ofrece una bandera para saltar esta validación.
- El KDS queda fuera por diseño y el script lo rechaza.

## Exportar en Caja

```powershell
cd C:\ruta\del\kit
.\sync-fingerprint-templates.ps1 -Mode Export -BundlePath C:\Temp\amalay.fpsync
```

Guardar la clave efímera de transferencia que aparece. Su vigencia práctica está
ligada a las 24 horas del bundle; puede importar ese bundle en varias secundarias.
Transferir el `.fpsync` por el canal
administrativo (TeamViewer o Tailscale). Si es posible, comunicar la clave por un
canal separado. No guardarla en `config.json` ni pasarla como argumento.

## Importar en cada POS secundario

```powershell
cd C:\ruta\del\kit
.\sync-fingerprint-templates.ps1 -Mode Import -BundlePath C:\Temp\amalay.fpsync
```

PowerShell pide la clave sin dejarla en el historial. El import verifica HMAC,
tenant, rol, vigencia de 24 horas, IDs, tamaños y SHA-256 antes de tocar el
directorio activo. Luego instala con ACL privado y deja un respaldo recuperable
`C:\fullsite\fingerprints-backup-AAAAMMDD-HHMMSS`.

Abrir Fullsite POS y confirmar que el log indique el mismo conteo de templates en
Caja y secundaria. Probar PIN primero y después una huella preparada para esa
terminal. No borrar bundle ni respaldo hasta terminar la aceptación.

## Recuperación

Si la verificación falla, cerrar Fullsite POS, renombrar
`C:\fullsite\fingerprints` para conservar evidencia y devolver el respaldo más
reciente al nombre `C:\fullsite\fingerprints`. El script también revierte
automáticamente si falla durante el intercambio.

## Camino posterior al piloto

La sincronización automática requiere una clave de cifrado por terminal
(X25519 o equivalente), enrolada junto con la identidad Ed25519. Caja debe exigir
la firma de la terminal, cifrar el bundle a esa clave y mantener replay protection.
El secreto LAN puede proteger transporte, pero nunca ser la única autoridad ni
la clave que hace legible la biometría.
