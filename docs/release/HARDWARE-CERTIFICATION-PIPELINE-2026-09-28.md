# Pipeline de certificación de hardware — Amalay

> Estado: **preparación**. Este pipeline no autoriza compras adicionales,
> instalación, enrolamiento, producción, pagos ni una prueba T-24. Ordena el
> trabajo que sí puede avanzar con la Caja Windows de laboratorio mientras se
> dispone de una estación física representativa.

## Objetivo

No declarar que Fullsite funciona con cualquier hardware. El primer alcance
certificable es una estación Windows 11 x64 y periféricos concretos. Todo
hardware de un restaurante distinto entra como compatible sólo después de
pasar esta misma matriz.

## Estación representativa prevista

- Terminal POS Windows 11 x64, 15 pulgadas táctil, 8 GB RAM, 128 GB SSD y
  Ethernet.
- Impresora térmica de 80 mm con autocorte, preferentemente Ethernet y
  compatible con ESC/POS.
- Cajón RJ11/RJ12 conectado a la impresora, no directo a la terminal.
- Escáner USB de 1D/2D en modo teclado.
- UPS line-interactive y switch Ethernet separado.

El lector de pagos, una segunda Caja, KDS físico y una impresora de cocina no
forman parte de esta primera compra: cada uno requiere un contrato de producto
y una matriz de seguridad propia.

## Carril A — Windows de laboratorio, disponible ahora

| Gate | Trabajo | Sale con | No acredita |
| --- | --- | --- | --- |
| A0 | Inventario del host, versión de Windows/Electron, resolución, escala y drivers instalados | Perfil reproducible del laboratorio | Hardware de restaurante |
| A1 | P19 sintético: login, turno, borrador, guardar, envío, KDS, ACK incierto, replay y reinicios | Evidencia del candidato exacto | Impresión/cajón/touch físicos |
| A2 | Matriz visual en 1280×800, 1366×768 y 1440×900; navegación por teclado y foco | Defectos de layout y accesibilidad detectados antes de campo | Ergonomía táctil real |
| A3 | Simulación de impresora/cajón, desconexión de red y recuperación | Contratos de fallo y observabilidad | Driver, cableado o pulso físico |
| A4 | Build, regresión, NetLogs completos y auditoría renderer para el mismo candidato | Paquete candidato para campo | T-24 o autorización de piloto |

Un resultado `PASS` en A0–A4 mantiene UI HOLD. En particular, simulación de
periféricos no permite abrir un cajón físico ni enviar una orden real.

## Carril B — estación física, cuando llegue

| Gate | Ejercicio | Evidencia requerida |
| --- | --- | --- |
| B0 | Inventario de terminal, monitor/touch, impresora, cajón, escáner, UPS y red | Modelo, versión, resolución, DPI/DPR, drivers y hash del instalador; sin secretos ni IPs |
| B1 | Terminal táctil | Controles operables con dedo; tamaño y foco visibles en las tres resoluciones aplicables |
| B2 | Impresora y cajón | Recibo de prueba canónico, un único pulso autorizado y estado incierto que no duplica el efecto |
| B3 | Escáner | Lectura de código 1D y QR/2D como entrada, sin convertir el escáner en autoridad de precio o producto |
| B4 | Red y energía | Reanudación tras desconexión y UPS; ningún dato durable se borra ni se reintenta un cobro automáticamente |
| B5 | T-24 | Misma secuencia y candidato descritos en `AMALAY-PILOT-READINESS-2026-09-27.md` |

B0–B4 se realizan sólo después de que los gates P19 de software permitan
programar T-24. El único `field pass` útil es el que corresponde al mismo
commit, paquete y configuración que B5.

## Política de compatibilidad inicial

1. **Certificado:** la estación exacta y el conjunto de periféricos que pasó
   B0–B5.
2. **En evaluación:** hardware de un restaurante que coincide en interfaces,
   pero aún no tiene evidencia de B0–B4.
3. **No soportado:** SO sin soporte, terminal sin drivers verificables,
   interfaces propietarias sin contrato o periféricos que exijan credenciales
   de un tercero.

No se promete compatibilidad universal. El dashboard web puede evaluarse en
navegadores modernos por separado; Caja/Electron se certifica como Windows
11 x64 hasta que otra plataforma tenga su propio gate.

## Salida del pipeline

El pipeline termina sólo si A0–A4 y B0–B5 están completos para el candidato
exacto, el rollback está practicado y la revisión humana aprueba el piloto
limitado. JEV puede indexar evidencia redactada, pero no cambia estados ni
certifica hardware.
