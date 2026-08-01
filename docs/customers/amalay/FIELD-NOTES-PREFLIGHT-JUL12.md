# FIELD NOTES — Preflight AMALAY Jul 12, 2026

> Sesion fisica domingo. 3 terminales configuradas y validadas.

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
- USB: `{ type: "usb", names: ["..."] }` (requiere impresora compartida en Windows)
- Array (multi-target): `[ {...}, {...} ]` — envia a TODAS

## Terminal: CAJA (SERVER1) — PASS

**printers.json:**
```json
{"port":7717,"stations":{"cocina":[{"type":"tcp","host":"192.168.1.21","port":9100},{"type":"tcp","host":"192.168.1.40","port":9100}],"barra":{"type":"tcp","host":"192.168.1.30","port":9100},"caja":{"type":"usb","names":["PANADERIA"]},"tickets":{"type":"usb","names":["EC01","EC TICKET"]}},"default":"tickets"}
```

**Impresoras Windows:** PANADERIA (Shared=TRUE), EC01, EC TICKET, COCINA FRIA, COCINA CALIENTE, BARRA, Canon (2), A6E

**Cambios locales:**
- start-bridge.bat eliminado del Startup
- PANADERIA compartida (Set-Printer -Shared $true)
- printers.json: caja/tickets cambiados de type:windows a type:usb
- EC01/EC TICKET no se pudieron compartir (Access denied, usuario Cliente sin admin)

**Smoke:**
| Test | Resultado |
|---|---|
| Huella visible cold start | PASS |
| Huella autentica | PASS |
| Comanda cocina fria (192.168.1.21) | PASS |
| Comanda cocina caliente (192.168.1.40) | PASS |
| Comanda barra (192.168.1.30) | PASS |
| Cobro efectivo | PASS |
| Ticket caja (PANADERIA USB raw) | PASS |
| Conflict check | PASS |

## Terminal: ENTRADA (PDV3) — PASS

**printers.json:**
```json
{"port":7717,"stations":{"cocina":[{"type":"tcp","host":"192.168.1.21","port":9100},{"type":"tcp","host":"192.168.1.40","port":9100}],"barra":{"type":"tcp","host":"192.168.1.30","port":9100},"caja":{"type":"usb","names":["TICKET"]},"tickets":{"type":"usb","names":["TICKET"]}},"default":"tickets"}
```

**Impresoras Windows:** TICKET (Shared=TRUE), PANADERIA, COCINA FRIA, COCINA CALIENTE, BARRA

**Cambios locales:**
- start-bridge.bat eliminado del Startup
- printers.json editado: caja/tickets a type:usb con TICKET
- TICKET ya estaba compartida

**Smoke:**
| Test | Resultado |
|---|---|
| Huella visible cold start | PASS |
| Comanda cocina | PASS |
| Comanda barra | PASS |
| Ticket caja | No testeado explicitamente |

## Terminal: ESCONDITE (PDV1) — PASS (comandas only)

**printers.json:**
```json
{"port":7717,"stations":{"cocina":[{"type":"tcp","host":"192.168.1.21","port":9100},{"type":"tcp","host":"192.168.1.40","port":9100}],"barra":{"type":"tcp","host":"192.168.1.30","port":9100},"caja":{"type":"tcp","host":"192.168.1.250","port":9100},"tickets":{"type":"tcp","host":"192.168.1.250","port":9100}},"default":"tickets"}
```

**Impresoras Windows:** PANADERIA (192.168.1.250, unreachable), COCINA FRIA, COCINA CALIENTE, BARRA, Canon (2), A6E. NO tiene TICKET ni EC01.

**Cambios locales:**
- start-bridge.bat eliminado del Startup
- printers.json creado (no existia antes)

**Smoke:**
| Test | Resultado |
|---|---|
| Huella visible cold start | PASS |
| Comanda cocina fria + caliente | PASS |
| Comanda barra | PASS |
| Ticket caja | FAIL — 192.168.1.250 unreachable |

**Ticket issue:**
- PANADERIA en Escondite apunta a 192.168.1.250 (TCP) — host unreachable
- No hay impresora de tickets USB local
- Windows printer sharing a SERVER1\PANADERIA requiere credenciales no disponibles (password "1234" es incorrecta para SERVER1)
- Escondite puede tomar ordenes y enviar comandas pero NO puede imprimir ticket de cobro
- FIELD NOTE: resolver con acceso fisico a credenciales de red o impresora USB

## Issues encontrados y resueltos hoy

| Issue | Root cause | Fix | Terminal |
|---|---|---|---|
| PIN-only sin huella | start-bridge.bat standalone ocupaba 7717 | Eliminado del Startup | Caja, Entrada, Escondite |
| /health port/stations/default | loadStations() retornaba wrapper | return data.stations \|\| data | Todas (rebuild exe) |
| Cocina no imprime | Array de impresoras no soportado | Array.isArray + iterate all | Todas (rebuild exe) |
| Ticket basura numeros | PANADERIA no compartida, PowerShell GDI fallback | Set-Printer -Shared $true | Caja |
| type:windows no reconocido | Bridge solo soporta usb/tcp | printers.json editado a type:usb | Caja, Entrada |
| Conflict toast al cobrar | Client time vs server trigger time | Fix c29e75e: lee server updated_at | Vercel deploy |
| Escondite sin ticket | 192.168.1.250 unreachable, no USB local | PENDIENTE | Escondite |

## Builds comparados

| Feature | Build viejo (Jul 8, hardcoded) | Build nuevo (Jul 12, dynamic) |
|---|---|---|
| Impresoras | Hardcoded en main.js | Dinámico via printers.json |
| Cocina multi-target | Solo 1 IP | Array: cocina fria + caliente |
| loadStations parser | N/A (hardcoded) | data.stations \|\| data |
| Fingerprint crash | Muere sin restart | Auto-restart 5 intentos |
| Offline page | No existe | offline.html con retry |
| Auto-start Windows | No | Si (registro Windows) |
| did-finish-load | No | Si (pos_last_boot localStorage) |

## Pendientes para operacion

- [ ] Resolver ticket en Escondite (credenciales de red o impresora USB)
- [ ] Configurar KDS en pantalla de cocina
- [ ] Probar cold start completo (apagar/prender PC)
- [ ] Probar ticket en Entrada (no se testeo explicitamente)
- [ ] Registrar huellas de Eduardo y meseros
