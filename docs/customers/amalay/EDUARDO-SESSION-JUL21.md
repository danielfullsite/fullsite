# Sesion Eduardo en AMALAY — Jul 21, 2026

**Lugar:** AMALAY Coffee & Market, terminales fisicas
**Asistentes:** Daniel, Eduardo
**Proxima sesion:** Jul 22, 7pm — revision Dashboard punto por punto

---

## Hallazgos Criticos (P0)

### 1. Offline NO funciona
- Apagaron internet y el POS muestra "Sin conexion al servidor"
- Eduardo confirma: el sistema tiene que sobrevivir sin internet
- Las impresoras funcionan por red local (IP), no dependen de internet
- KDS tampoco carga sin internet
- **Wansoft/NetSilver funciona sin internet** — Fullsite no puede ser peor

### 2. KDS Cocina muestra ordenes de Barra
- Las bebidas (ej. Heineken) aparecen en KDS de cocina
- Solo debe mostrar items enviados a la impresora de cocina
- Chef se confunde viendo items que no son suyos

---

## Feedback KDS (cocina)

### Ordenamiento
- **Ordenes mas viejas primero** (prioridad por tiempo de ingreso)
- La mas vieja debe estar arriba/primero, parpadeando si lleva mucho
- Alerta visual de "te estas tardando" pero NO molesta (sin sonido agresivo en estres)

### Items nuevos en mesa existente
- Si se agregan items a una mesa que ya tiene comanda, **abrir NUEVA comanda**
- No agregar a la comanda existente — el chef no se da cuenta
- La nueva comanda va al FINAL (menos prioridad que las anteriores)
- Respetar orden de ingreso siempre

### Compactar
- Reducir tamano de letra ~10% para que quepan mas ordenes a lo ancho
- En un lleno hay ~15 comandas activas con 33 mesas
- Necesita caber en la pantalla sin mucho scroll

### Listado de platillos pendientes (lado izquierdo)
- Ordenar por DEMANDA (lo mas pedido arriba), no por tiempo
- Ejemplo: "5 ensaladas de papa" arriba, "1 ceviche" abajo
- El chef usa esto para saber que preparar en batch

### Filtro por estacion
- KDS cocina solo muestra items de cocina
- KDS barra solo muestra items de barra
- No mezclar estaciones

---

## Feedback POS (punto de venta)

### Flujo post-envio
- Despues de enviar orden a cocina → **regresar automaticamente al mapa de mesas**
- No quedarse en la pantalla de la orden
- Mesero envia y se va a atender otra mesa

### Vista default
- **Grid por default**, no plano
- El plano es opcional para quien lo quiera ver
- Grid es mas practico para operacion rapida

### Filtro por mesero
- Mesero solo ve SUS mesas (azules)
- Omar solo ve las moradas
- No puede abrir mesa asignada a otro mesero
- Si quiere abrir mesa nueva, selecciona numero disponible

### Pantalla de bloqueo
- Despues de enviar → pantalla de bloqueo (PIN)
- Cada mesero se registra con su PIN para ver sus mesas
- Previene que un mesero entre a mesas de otro

### Items enviados = no editables
- Un platillo ya enviado NO se puede editar ni modificar
- Solo se puede CANCELAR (con permiso gerente)
- O TRANSFERIR a otra mesa (con permiso supervisor)

### Transferir platillos
- Renombrar "Transferir a mesa" → "Transferir platillo"
- Solo con permiso de supervisor
- **Transferencias son foco de fraude** — Eduardo lo enfatizo mucho
- Esquema de fraude: mesero transfiere coctel de $200 entre mesas para quedarse propina
- Reporte diario de transferencias es CRITICO

### Juntar/separar mesas
- Poder juntar 2 mesas: seleccionar cuales, asignar numero
- Visualmente se ven juntas o ambas aparecen con el mismo numero
- Operacion comun en restaurantes

---

## Feedback Tickets/Recibos

### Numero de orden
- Mostrar NUMERO de orden, no letras/UUID
- Mas facil para el mesero y el cliente

### Configuracion de ticket
- Cada restaurante configura: nombre, direccion, telefono, redes sociales, logo
- Template listo para que el usuario lo modifique
- No depender de que Daniel lo configure manualmente para cada cliente

---

## Feedback Seguridad/Anti-fraude

### Permisos
- Cancelaciones: solo con permiso de gerente
- Transferencias de platillos: solo con permiso de supervisor
- Anular orden completa: solo con permiso de gerente/admin
- Eduardo: "ese permiso yo no se lo doy a nadie, solo yo lo tengo"

### Reporte diario al dueño
- Email automatico al cerrar turno:
  - Ventas totales
  - Comensales
  - Ticket promedio
  - Cancelaciones (cuantas, cuales)
  - Descuentos
  - Cortesias
  - **Transferencias** (cuantas, cuales — foco de fraude)
- Destinatario: email del dueno

### Deteccion de transferencias sospechosas
- Si un platillo se mueve constantemente entre mesas → alerta
- Daniel ya tiene agente de IA anti-fraude que detecta esto

---

## Feedback General / Estrategico

### Simplicidad
- "Hazlo lo mas simple pero fregon"
- "Que cualquiera le entienda, cualquiera lo pueda operar"
- NetSilver es poderoso pero nadie le entiende
- "Tu sistema es tan bueno que nadie lo entiende" — lo dijo de NetSilver como critica

### Configuracion desde Dashboard
- Todo lo configurable debe estar en el Dashboard, no en el POS
- Gerente abre su compu, entra al Dashboard, configura
- El POS es solo para operacion

### Agente guia
- El agente de IA debe guiar paso a paso: "como configuro un platillo?"
- Te manda la liga o te dice paso por paso
- Reemplaza soporte tecnico
- "Eso seria el diferenciador" — Eduardo

### Diferenciador de Fullsite
- No es el POS (cualquiera lo puede copiar)
- Es la inteligencia artificial procesando datos en tiempo real
- Informacion procesada que no te da ningun otro punto de venta
- Decisiones en el momento, no al final del mes
- Eduardo: "ese es el diferenciador, la nueva era"

### Soporte
- No contratar tecnicos fijos
- Contratar por evento cuando se necesite hardware
- El soporte de software debe ser via agente IA + Dashboard

---

## Comparacion NetSilver vs Fullsite (observaciones de Eduardo)

### Lo que NetSilver hace bien
- Configuracion muy granular (tamano de botones, letra, ticket)
- Permisos muy detallados
- No permite ambiguedad en nombres (bloquea duplicados)
- Perifericos configurables
- Funciona sin internet

### Lo que NetSilver hace mal
- Demasiado complejo — nadie le entiende
- Interfaz fea y anticuada
- Muchas opciones innecesarias (megapuntos, nomina, etc.)
- Soporte malo
- No tiene IA

### Lo que Fullsite necesita copiar
- Configuracion de ticket desde la app
- Tamano de letra/botones configurable
- Huellas digitales registradas desde la app
- Perifericos configurables
- **Funcionamiento sin internet**

### Lo que Fullsite ya tiene mejor
- IA y agentes
- Dashboard moderno
- KDS funcional y bonito
- Deteccion de fraude automatica
- Interfaz moderna y limpia

---

## Acciones para manana (Jul 22)

1. Eduardo estudia NetSilver config esta noche (caja)
2. Daniel documenta logica de NetSilver POS
3. Sesion 7pm: revisar Dashboard punto por punto con agente IA
4. Eduardo prueba el agente guia en cada seccion del Dashboard

---

## Proximos fixes (prioridad Eduardo)

| # | Fix | Prioridad | Esfuerzo |
|---|-----|-----------|----------|
| 1 | KDS: filtrar por estacion (no mezclar cocina/barra) | P0 | 1-2 hrs |
| 2 | KDS: ordenar mas viejas primero | P0 | 30 min |
| 3 | KDS: nueva comanda para items nuevos de mesa existente | P1 | 2-3 hrs |
| 4 | POS: auto-return a mapa despues de enviar | P1 | 30 min |
| 5 | POS: Grid como default, no plano | P1 | 5 min |
| 6 | POS: filtrar mesas por mesero | P1 | 2-3 hrs |
| 7 | POS: bloqueo post-envio (regresa a PIN) | P1 | 1 hr |
| 8 | POS: items enviados no editables | P1 | 1 hr |
| 9 | Ticket: numero de orden (no UUID) | P1 | 30 min |
| 10 | Ticket: template configurable por cliente | P2 | 3-4 hrs |
| 11 | Offline: funcionar sin internet (arranque) | P0 | Arquitectural |
| 12 | KDS: reducir letra 10%, compactar | P2 | 30 min |
| 13 | Reporte diario email al dueno | P2 | 2 hrs |
| 14 | Transferencia de platillos con permiso | P1 | 1-2 hrs |
