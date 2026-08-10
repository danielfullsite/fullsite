# Instalar un restaurante nuevo — guía operativa

Esta guía permite a Eduardo instalar un cliente nuevo sin editar código y sin
usar datos de AMALAY. Si un comando muestra `FAIL` o `ABORTANDO`, detenerse y
copiar el mensaje completo al canal de soporte; no improvisar cambios en SQL.

## Antes de salir al restaurante

Necesitas:

- La laptop con este repositorio actualizado.
- El archivo de acceso de **staging** entregado por Daniel mediante el gestor
  de secretos. No pegar llaves en WhatsApp, documentos o comandos.
- Dos manifests preparados por onboarding:
  - `cliente-cloud.json`: identidad, dueño, plantilla y project ref.
  - `cliente-terminals.json`: POS, KDS, impresoras y rutas por estación.
- El instalador de Fullsite y una USB vacía.

Los dos manifests usan el mismo `client_id`. Tener dos archivos es temporal y
explícito: nube y hardware tienen contratos distintos. Ninguno requiere editar
TypeScript, Electron o SQL.

## 1. Abrir la terminal en Fullsite

En macOS abre **Terminal**. En Windows abre **PowerShell**. Entra a la carpeta
del repositorio:

```bash
cd fullsite
```

## 2. Verificar identidad y destino

Abre `cliente-cloud.json` y confirma con el gerente:

- nombre visible;
- correo del dueño;
- `client_id`;
- `confirm_ref` del sandbox autorizado;
- zona horaria y hora de inicio del día operativo.

Nunca continuar si aparece `qjiomlvudfmzuvqvhwpk` o `client_id: amalay`.

Carga el archivo de acceso de staging sin imprimirlo:

```bash
set -a
source /ruta/segura/fullsite-staging.env
set +a
```

## 3. Validar las terminales antes de escribir datos

```bash
node scripts/manifests/validate_manifest.mjs cliente-terminals.json
```

Resultado esperado: `1/1 manifests válidos`.

Genera los archivos que consumirá Electron:

```bash
node scripts/manifests/generate_terminal_config.mjs cliente-terminals.json ./terminal-output
```

Resultado esperado: una carpeta por terminal. El POS contiene `config.json` y
`printers.json`; el KDS contiene `config.json`. Si falta cualquiera, detenerse.

## 4. Ensayo sin escribir en Supabase

```bash
python3 scripts/onboarding/onboard_client.py cliente-cloud.json --dry-run
```

Revisa que el resumen muestre el cliente correcto y no AMALAY. Un error de
destino o manifest se corrige antes de continuar.

## 5. Aprovisionar el cliente

```bash
python3 scripts/onboarding/onboard_client.py cliente-cloud.json
```

Guarda la contraseña temporal mostrada una sola vez en el gestor de secretos.
No tomar captura ni enviarla por chat. El resultado final debe ser `PASS`.

Si se corta internet, no reinicies desde cero:

```bash
python3 scripts/onboarding/onboard_client.py cliente-cloud.json --resume
```

## 6. Instalar POS, KDS e impresoras

En cada equipo:

1. Instala Fullsite con el instalador aprobado.
2. Abre el asistente de configuración.
3. Importa el `config.json` de esa terminal.
4. En POS/Caja importa también su `printers.json`.
5. Confirma que el nombre de terminal y restaurante sean correctos.
6. Ejecuta una impresión de prueba por cada estación configurada.

No reutilices archivos de otra terminal: cada `terminal_id` es estable y único.

## 7. Smoke operativo obligatorio

Con el usuario y PIN sintéticos/entregados, recorre en este orden:

1. Login del dueño.
2. PIN de gerente.
3. Abrir turno.
4. Abrir mesa y agregar producto.
5. Enviar; verificar KDS y ticket de estación.
6. Cobrar con método de prueba.
7. Hacer cierre de caja.
8. Refrescar y confirmar que orden y cierre persisten.

Después ejecuta:

```bash
python3 scripts/onboarding/smoke_test.py --help
python3 scripts/onboarding/smoke_test.py --client-id <client_id> --confirm-ref <confirm_ref>
```

Reemplaza solamente los dos valores entre `< >` con los del manifest de nube.
Debe terminar en `PASS`.

## 8. Criterios de detención

Detener la instalación si ocurre cualquiera:

- destino de Supabase distinto al `confirm_ref`;
- aparece AMALAY en pantalla, logs o datos;
- POS y KDS muestran restaurantes distintos;
- una impresora recibe tickets de otra estación;
- login, turno, orden, cobro o cierre no persisten tras refrescar;
- el smoke termina en `FAIL`.

No ejecutar `--teardown` salvo instrucción explícita del responsable técnico.

## Evidencia mínima de entrega

Guardar en la carpeta del cliente:

- resultado del onboarding sin secretos;
- lista de terminales y sus nombres;
- foto de cada impresión de prueba;
- captura de orden en KDS;
- captura del cobro y del cierre;
- commit instalado y hora de la prueba.
