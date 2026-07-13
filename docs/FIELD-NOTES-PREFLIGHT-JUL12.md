# FIELD NOTES — Preflight AMALAY Jul 12, 2026

> Sesion fisica domingo. Caja configurada y validada.

---

## CAJA-KNOWN-GOOD Artifact

| Item | Valor |
|---|---|
| Commit SHA | 29320005fe9399ace59d861dfeb6f64ce2fca5b3 |
| Commit message | fix(electron): support array of printers per station |
| EXE SHA-256 | c6ccd31c6c34567408374b49dd63cb8aa6ff4ab56ed904ce186a14a6d3d2b579 |
| EXE timestamp | Jul 12 19:34:16 2026 |
| APP.ASAR SHA-256 | a984d6ce32878441980602315cfa3c8d30425b2a0745ad0199df422e2dd50fcc |
| Build platform | Windows x64, electron-builder 25.1.8, Electron 33.4.11 |

## printers.json schema canonico

```json
{
  "port": 7717,
  "stations": {
    "<station>": { "type": "tcp", "host": "<ip>", "port": 9100 },
    "<station>": { "type": "usb", "names": ["<printer_name>"] },
    "<station>": [ { "type": "tcp", ... }, { "type": "tcp", ... } ]
  },
  "default": "<station>"
}
```

Bridge parsea `data.stations || data`. Soporta:
- TCP simple: `{ type: "tcp", host, port }`
- USB: `{ type: "usb", names: ["..."] }`
- Array (multi-target): `[ {...}, {...} ]` — envia a TODAS

## printers.json efectivo Caja (PASS)

```json
{"port":7717,"stations":{"cocina":[{"type":"tcp","host":"192.168.1.21","port":9100},{"type":"tcp","host":"192.168.1.40","port":9100}],"barra":{"type":"tcp","host":"192.168.1.30","port":9100},"caja":{"type":"usb","names":["PANADERIA"]},"tickets":{"type":"usb","names":["EC01","EC TICKET"]}},"default":"tickets"}
```

## Cambios locales Windows hechos en Caja hoy

| Cambio | Detalle | Persistente |
|---|---|---|
| start-bridge.bat eliminado | `del` del Startup folder | Si — no regresa al reiniciar |
| PANADERIA compartida | `Set-Printer -Shared $true` | Si — config de Windows |
| EC01/EC TICKET no compartidas | Access denied (usuario Cliente sin admin) | N/A — no se usan para caja |
| printers.json editado | windows→usb para caja/tickets | Si — archivo en disco |
| Fullsite POS auto-start | app.setLoginItemSettings (en main.js) | Si — registro de Windows |

## Smoke test Caja — PASS

| Test | Resultado |
|---|---|
| Fullsite abre en kiosk | PASS |
| Huella visible al cold start | PASS (3/3 restarts) |
| Huella autentica | PASS |
| Bridge health (cocina/barra/caja/tickets) | PASS |
| Fingerprint service health | PASS (enrolled=1) |
| Comanda cocina fria (192.168.1.21) | PASS |
| Comanda cocina caliente (192.168.1.40) | PASS |
| Comanda barra (192.168.1.30) | PASS |
| Cobro efectivo | PASS |
| Ticket caja (PANADERIA, raw USB) | PASS |
| Conflict check (updated_at server-side) | PASS |
| Orden persiste en DB | PASS (status=cerrada, pagos reconciliados) |

## Issues encontrados y resueltos

| Issue | Root cause | Fix |
|---|---|---|
| PIN-only (sin huella) | start-bridge.bat iniciaba standalone bridge en 7717, sin proxy /fp/ | Eliminado start-bridge.bat del Startup |
| Conflict toast al cobrar | loadedUpdatedAt usaba client time vs server trigger time | Fix c29e75e: lee server updated_at post-save |
| /health muestra port/stations/default | loadStations() retornaba wrapper completo | Fix 6e07167: return data.stations \|\| data |
| Cocina no imprime | Array de impresoras no soportado | Fix 2932000: Array.isArray + iterate all |
| Ticket basura en caja | PANADERIA no compartida, fallback PowerShell GDI | Set-Printer -Shared $true |
| type: "windows" no reconocido | Bridge solo soporta "usb" y TCP | Editado printers.json: windows→usb |

## Pendiente para Entrada y Escondite

- Instalar MISMO exe (SHA c6ccd31c...)
- NO recompilar
- Adaptar printers.json por terminal (mismos IPs pero printer names pueden variar)
- Verificar/eliminar start-bridge.bat en Startup
- Verificar que impresoras USB esten compartidas
- Smoke test individual por terminal
