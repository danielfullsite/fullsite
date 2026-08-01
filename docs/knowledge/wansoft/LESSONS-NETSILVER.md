# Lecciones de Wansoft & NetSilver

> Resultado del reverse engineering del código fuente de NetSilver (BD Wansoft en producción en AMALAY).  
> **41 lecciones** organizadas en 4 categorías. 15 temas.  
> Fecha del análisis: 2026-06-09. Base de datos: `BD NetSilver` en SSMS, acceso via TeamViewer.

---

## Contexto

Wansoft opera restaurantes en México desde hace 20+ años. NetSilver es el motor de base de datos (SQL Server) que usa Wansoft internamente. El análisis cubrió:

- 822 stored procedures
- 47 formatos de impresión
- Modelo de datos completo de AMALAY (6 almacenes, 574 recetas)
- Transacciones históricas de 2+ años

El objetivo: entender qué funcionó bien en Wansoft durante 20 años para adoptarlo, qué tiene problemas para mejorarlo, y qué no replicar.

---

## Las 41 lecciones

### Mantener (14) — lo que Wansoft hace bien

**Modelo de datos**
1. El modelo de recetas como unidad fundamental del negocio es correcto. Todo se deriva de la receta: ingredientes, costo, inventario, producción.
2. Los almacenes separados (Cocina Principal, Pastelería, Bar, etc.) reflejan la realidad operacional. No mezclar inventario de todos en uno.
3. Los vales de transferencia entre almacenes son el mecanismo correcto para mover inventario interno — no ajustes directos.

**Operación del día**
4. El turno (apertura → operación → cierre) como contenedor del día es el modelo correcto. Nada existe fuera de un turno.
5. El conteo físico al cierre con diferencia documentada es no-negociable. Wansoft lo fuerza — nosotros también.
6. Las cortesías y descuentos requieren autorización de gerente. El log inmutable de quién, cuándo, cuánto, por qué.

**Impresión**
7. Los formatos de impresión son configurables por estación (cocina vs barra vs caja). No un formato único.
8. La reimpresión tiene su propio log — distinto de la impresión original. Permite auditoría.
9. Los comandos a cocina tienen número consecutivo por turno. Permite rastrear si llegó todo.

**Fiscal**
10. El RFC del cliente en la factura se valida antes de emitir, no después. Ahorra re-timbrado.
11. Los métodos de pago son extensibles (efectivo, tarjeta, transferencia, vale, Uber Eats). No hardcodeados.

**Seguridad**
12. El PIN de acceso por rol es el mecanismo correcto para un ambiente de restaurante — más rápido que password, suficientemente seguro.
13. El log de acciones por usuario es la única forma de auditar fraude. Wansoft lo tiene; nosotros también.

**Estructura de menú**
14. La jerarquía Grupo → Subgrupo → Platillo refleja cómo los gerentes piensan el menú. Respetarla.

---

### Mejorar (9) — lo que Wansoft hace bien pero podemos hacer mejor

1. **Costo de receta en tiempo real** — Wansoft calcula el food cost al cierre del día. Fullsite lo calcula al momento de cada venta. Diferencia: el gerente puede reaccionar durante el día.

2. **Reportes en tiempo real** — Wansoft genera reportes PDF estáticos. Fullsite usa dashboards en vivo. El gerente ve el número cuando lo necesita, no cuando el sistema genera el reporte.

3. **Alertas de inventario** — Wansoft alerta cuando el inventario llega a cero. Fullsite alerta cuando el inventario va a llegar a cero en X horas (basado en velocidad de venta). Preventivo vs reactivo.

4. **Multi-dispositivo sin instalación** — Wansoft requiere instalación de cliente Windows en cada terminal. Fullsite corre en browser — cualquier tablet es una terminal en 2 minutos.

5. **Backup automático** — Wansoft requiere backup manual a una carpeta de red. Fullsite sincroniza a la nube automáticamente. Un restaurante pierde datos si se olvidan de hacer el backup.

6. **UX de menú** — la interfaz de configuración de menú de Wansoft es una grilla de Excel. Fullsite tiene una interfaz visual con drag-and-drop y preview.

7. **Acceso remoto** — para ver datos de Wansoft remotamente hay que entrar via TeamViewer. Fullsite tiene dashboard web accesible desde cualquier lugar.

8. **Modificadores en POS** — Wansoft pide el modificador antes de confirmar la orden. Fullsite permite modificarlo después (antes de enviar a cocina). Más flexible para cambios de último momento.

9. **Transferencia entre almacenes** — Wansoft hace el vale en papel y lo registra manualmente. Fullsite lo hace digital con aprobación y log automático.

---

### Evitar (12) — lo que Wansoft hace mal

**Arquitectura**
1. **822 stored procedures** — toda la lógica de negocio está en SQL Server. Imposible de testear, imposible de versionar, imposible de cambiar sin romper algo. Fullsite pone la lógica en el código, no en la DB.

2. **Dependencia de SQL Server** — Wansoft está atado a SQL Server 2019 en Windows. Migrar es imposible. Fullsite usa Postgres (Supabase) — portable, moderno, cloud-native.

3. **Sin multi-tenant** — cada restaurante de Wansoft tiene su propia instancia de BD. Para agregar un cliente hay que instalar SQL Server de nuevo. Fullsite es multi-tenant desde día 1.

4. **Sin versioning de schema** — el schema de Wansoft no tiene historial de migrations. Nadie sabe cuándo se agregó qué columna ni por qué. Fullsite tiene migrations numeradas.

**Operación**
5. **Offline es frágil** — Wansoft tiene un modo offline, pero si la conexión se cae durante ciertos operaciones (sync de inventario), puede corromper datos. El proceso de recovery es manual.

6. **Actualizaciones requieren downtime** — actualizar Wansoft requiere cerrar el restaurante, ir en persona, y reinstalar. Fullsite actualiza automáticamente en el background.

7. **Sin rollback** — si una actualización de Wansoft rompe algo, revertir requiere restaurar la BD completa desde backup. No hay rollback de versión de software.

**Soporte**
8. **Soporte por TeamViewer** — todo el soporte de Wansoft es via acceso remoto. No hay diagnóstico sin que el técnico se conecte. Fullsite tiene Manager Panel para diagnóstico sin intervención.

9. **Documentación inexistente** — no hay documentación oficial de Wansoft. El conocimiento está en las personas. Si el técnico de soporte sale, se pierde.

10. **Precio opaco** — el precio "base" de Wansoft es $2,800/mes pero en la práctica hay consultoría ($23K), soporte por hora ($1,160/hr), y módulos adicionales. Año 1 real = ~$102K. Fullsite: $4,999/mes all-in.

**Datos**
11. **Reportes en PDF** — los reportes de Wansoft son PDFs estáticos que hay que exportar. No hay API. No hay integración con nada. Fullsite expone los datos via API.

12. **Sin historial de recetas** — si cambias el costo de un ingrediente en Wansoft, el food cost histórico cambia retroactivamente. Fullsite versiona las recetas — el historial es inmutable.

---

### Oportunidades (6) — lo que Wansoft no tiene y nosotros podemos dar

1. **IA operacional** — Wansoft no tiene ningún tipo de IA o alertas inteligentes. Fullsite tiene 5 agentes activos que detectan anomalías, predicen cierre, y detectan oportunidades de upselling.

2. **Integración con Uber Eats / Rappi** — Wansoft maneja Uber Eats como un método de pago, no como un canal integrado. Las órdenes de delivery no entran al KDS automáticamente.

3. **Análisis de propinas** — Wansoft no tiene análisis de propinas por mesero. Es un indicador poderoso de satisfacción del cliente y performance del equipo.

4. **Predicción de compras** — basada en velocidad de venta + inventario actual, Fullsite puede generar órdenes de compra sugeridas automáticamente. Wansoft tiene compras sugeridas pero son manuales.

5. **App móvil para dueño** — el dueño de un restaurante con Wansoft no puede ver sus ventas desde el celular. Fullsite tiene dashboard web responsive que funciona en móvil.

6. **Multi-sucursal desde el cloud** — Wansoft requiere infraestructura separada por sucursal. Fullsite gestiona N sucursales desde un solo dashboard con vista consolidada.

---

## Los 15 temas del análisis

1. Modelo de recetas y food cost
2. Gestión de almacenes e inventario
3. Ciclo del turno (apertura, operación, cierre)
4. Formatos y protocolos de impresión
5. Fiscal (CFDI, RFC, métodos de pago)
6. Control de acceso y seguridad por rol
7. Audit log e inmutabilidad
8. Modelo de datos y schema
9. Arquitectura técnica (stored procedures, SQL Server)
10. Multi-tenant vs instancia por cliente
11. Offline y resiliencia
12. Actualizaciones y soporte
13. Reportes y acceso a datos
14. Integración con canales externos (Uber Eats, Rappi)
15. Oportunidades de IA y análisis avanzado

---

## Conclusión operativa

Wansoft funcionó 20 años porque resolvió el problema operacional correcto: registro de ventas, control de inventario, y cierre de caja confiable. Esos tres pilares están bien resueltos y debemos respetarlos.

Wansoft no escaló bien como plataforma porque tomó decisiones de arquitectura que fueron correctas en 2005 pero que ahora son deuda técnica: SQL Server, stored procedures, sin multi-tenant, sin API.

La oportunidad de Fullsite es exactamente esa intersección: adoptar los principios operacionales de Wansoft (que son correctos) en una arquitectura moderna (que permite escalar).

No copiamos Wansoft. Aprendemos de sus 20 años de operación y construimos sobre esa base.
