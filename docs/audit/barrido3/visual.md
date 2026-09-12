# Lente visual — capturas reales de los laboratorios Electron (1600x1200 y 2940x1728)

### [P1] Editor de cuenta: el nombre del platillo se rompe letra por letra y se encima con el asiento y la etiqueta
Archivo: dashboard-app/src/app/pos/page.tsx (renglón de item: nombre + botón de asiento S1 + badge "SIN COMANDA")
Captura: output/closure/ui/eduardo-mesa3-por-dentro-POS3.png
Escenario: a 1600px de ancho (tablet/caja con panel izquierdo ~800px), "Café de laboratorio" se parte en 4 líneas, el botón "S1" queda encima del texto, el badge "SIN COMANDA" tapa la palabra y el nombre termina en "Ca…". Con nombres reales de AMALAY (más largos) el mesero no lee qué platillo es.
Fix sugerido: columna del nombre con min-width y `truncate`/2 líneas máximo; botón de asiento y badge en fila aparte o a la derecha con `shrink-0`.

### [P2] Mapa de mesas: el total de la tarjeta se corta ("$116.0(")
Archivo: dashboard-app/src/app/pos/mesas/page.tsx (tarjeta de mesa, fila personas/total)
Captura: output/closure/ui/eduardo-mapa-antes-Caja.png
Escenario: con 5 columnas, el total de 3 dígitos con centavos no cabe; el nombre del mesero también se corta sin elipsis ("Operador de laboratori").
Fix sugerido: `tabular-nums` + `truncate` en mesero, total con `shrink-0` y fuente menor, o 4 columnas por debajo de 1700px.

### [P2] Editor: botón "Desc" con un icono suelto encimado a su derecha
Captura: eduardo-mesa3-por-dentro-POS3.png (fila de acciones)
Escenario: hay un icono de documento pegado al botón "% Desc" sin caja propia; parece un botón roto.

### [P2] Corte X muestra el id crudo del turno ("Turno mtx6d5o825j1 · Abierto · X")
Captura: output/closure/ui-operacion/corte-x-parcial-sin-wan.png
Fix sugerido: mostrar folio/hora de apertura y quién abrió; el id sólo en tooltip o en soporte.

### [P2] Pantalla de turno: dos botones "Consultar impresiones/aperturas por verificar" sin el estilo del resto (borde blanco plano, tamaño distinto)
Captura: output/closure/ui-operacion/cierre-turno-desde-pantalla.png

## Sin defecto visible
- KDS vacío (Cocina.png), modal de cobro (cobro-parcial-desde-botones.png), corte X.

## Límite
Sólo capturas de laboratorio con datos sintéticos; falta recorrer las pantallas reales con nombres de platillos de AMALAY y en la tablet física.
