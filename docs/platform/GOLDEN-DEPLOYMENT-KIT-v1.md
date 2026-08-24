# Golden Deployment Kit v1

Genera un paquete reproducible por restaurante sin modificar código ni copiar la identidad de otra sucursal.

## Entrada

El manifiesto declara:

- `restaurant_id`, nombre, canal e IP reservada de la caja/Pedro.
- Una sola terminal `server_pos` y cualquier número de terminales `pos`, `kds` o `admin`.
- `printers.json` schema v2 con conexiones y estaciones.

No contiene PINs, huellas, contraseñas ni llaves de Supabase.

Ejemplo: `scripts/deployment-kit/example.monclova.json`.

## Generar

```bash
node scripts/deployment-kit/generate-kit.cjs \
  --manifest scripts/deployment-kit/example.monclova.json \
  --out /ruta/segura/cliente-monclova-kit
```

Validar sin escribir:

```bash
node scripts/deployment-kit/generate-kit.cjs \
  --manifest scripts/deployment-kit/example.monclova.json \
  --validate-only
```

El generador falla cerrado si el directorio de salida ya existe.

## Salida

- Una carpeta por terminal con `config.json` único.
- `printers.json` únicamente para `server_pos`.
- `package-manifest.json` con terminales y SHA-256 de cada archivo.
- `INSTALL.md` con la secuencia en sitio.
- `smoke-test.ps1` que valida `/health`, `/identity`, `/state` y estaciones.

## Uso en Windows

1. Reservar la IP de caja declarada en el manifiesto.
2. Instalar Fullsite POS x64 e importar el config de la caja.
3. Importar `printers.json` en la caja y probar estaciones.
4. Instalar/importar el config correspondiente en cada POS/KDS.
5. Ejecutar desde la raíz del paquete:

```powershell
powershell -ExecutionPolicy Bypass -File .\smoke-test.ps1
```

6. Completar la prueba física online y WAN-off. El smoke HTTP no reemplaza la impresión real ni el corte de internet.

## Gate de CI

```bash
node --test scripts/deployment-kit/generate-kit.test.cjs
```

## Pendientes del v2

- Incluir/validar el instalador x64 firmado dentro del paquete.
- Descargar manifiestos desde `/platform` y generar por botón.
- QR/deep-link por terminal.
- Ticket de prueba automático por impresora.
- Subir evidencia y tiempo de instalación al control de flota.
