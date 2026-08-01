# Plan de Contingencia — Lunes AMALAY

> Checklist operativo. No desde el codigo. Desde la operacion.

---

## Infraestructura lista

| Item | Estado | Ubicacion / Detalle |
|------|--------|---------------------|
| Instalador RC final (.exe x64) | Compilado | electron-app/dist/Fullsite POS Setup 1.0.0.exe (78MB) |
| Backup instalador anterior | Pendiente | Copiar version Jul 7-8 a USB como rollback |
| USB con ambos instaladores | Pendiente | RC + anterior + printers.json |
| printers.json respaldado | Pendiente | Copiar antes de instalar |
| IPs impresoras | Documentar en sitio | Cocina: TCP ?, Barra: TCP ?, Caja: USB |
| Bridge embebido | Verificar en sitio | localhost:7717/health debe responder |
| Fingerprint service | Verificar en sitio | localhost:7718/health, auto-restart si crashea |
| PIN fallback | Probar en smoke test | Si huella falla, PIN debe funcionar |
| Hotspot celular | Pendiente | Datos suficientes, password conocido |
| Checklist impreso | Pendiente | WAR-ROOM-LUNES.md impreso o en tablet |
| Wansoft operativo | Verificar | Debe seguir instalado como contingencia |

---

## Procedimiento de rollback

Si se necesita revertir a Wansoft durante el servicio:

1. Cerrar Electron (Ctrl+Shift+Q o desde admin)
2. Abrir Wansoft normalmente
3. Wansoft tiene su propia base de datos local — no depende de Fullsite
4. Documentar que paso y por que se revirtio
5. No intentar arreglar Fullsite durante el servicio

Tiempo estimado de rollback: <2 minutos por terminal.

---

## Procedimiento de rollback del .exe

Si el RC tiene un problema que el instalador anterior no tenia:

1. Desinstalar Fullsite POS desde Agregar/Quitar programas
2. Instalar version anterior desde USB
3. Verificar que printers.json no se perdio (si se perdio, copiar del USB)

---

## Durante el servicio

- No abrir VS Code
- No hacer deploy
- No modificar codigo
- No improvisar fixes
- No cambiar configuraciones sin documentarlo
- Si hay duda, documentar y seguir operando
- Solo revertir si cumple criterio de rollback (6 condiciones en WAR-ROOM)

---

## Despues del turno — Captura inmediata

Ir a FIELD-NOTES.md y documentar:

1. Que salio mejor de lo esperado
2. Que salio peor de lo esperado
3. Que dudas tuvo Eduardo
4. Que dudas tuvieron los meseros
5. Que partes fueron intuitivas
6. Que partes generaron confusion
7. Que bugs aparecieron
8. Que fricciones aparecieron (no bugs, pero incomodas)
9. Que hariamos diferente para el restaurante #2

No confiar en la memoria. Documentar el mismo dia.

---

## Hipotesis del lunes

Una sola pregunta:

**Puede un restaurante operar con Fullsite sin depender de Wansoft?**

Si la respuesta es si, cruzamos el hito mas importante desde que empezo Fullsite.
