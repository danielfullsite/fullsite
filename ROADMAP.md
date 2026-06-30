# FULLSITE ROADMAP

> Estado real. No aspiracional.
> Ningun P1 se toca mientras exista un P0 abierto.
> Actualizar despues de cada sesion.
> Ultima actualizacion: 2026-06-30

---

## P0 — Bloquean Go-Live

- [ ] IEPS modelo fiscal (bloqueado: necesita XML de Wansoft)
- [ ] Facturama produccion (bloqueado: pago $1,650)
- [ ] XML CFDI validado contra Wansoft
- [ ] Concurrencia: updated_at en handlePayment
- [ ] Concurrencia: fix 409 en sync offline
- [ ] Concurrencia: separar KDS writes del campo items
- [ ] Huella digital (verificar Windows Hello con lector DP4500)
- [ ] Cajon (fix EC TICKET o mover RJ-11)
- [ ] Shadow Day

## P1 — Primera semana post-cutover

- [ ] Normalizar items a pos_order_items (ADR Opcion B)
- [ ] Supabase Realtime entre terminales
- [ ] Corte Z formal con reglas de negocio
- [ ] Fondo de propinas (recoleccion, reparto, retiro)
- [ ] NSSM para bridge auto-restart
- [ ] Device ID en audit log
- [ ] Intentos de corte registrados
- [ ] Catalogo de razones predefinido
- [ ] Reimprimir comanda desde KDS
- [ ] Reportes exportables a Excel

## P2 — Primeros 10 restaurantes

- [ ] CRM de clientes (historial, RFC guardado, CxC)
- [ ] Terminal bancaria (Clip REST)
- [ ] Catalogo editable desde POS
- [ ] Cancelacion CFDI ante SAT
- [ ] Permisos configurables por usuario
- [ ] Multi-tenant onboarding automatizado
- [ ] Integracion Uber Eats API
- [ ] Consumo interno (tipo de orden)
- [ ] Produccion/batch cooking

## P3 — Primeros 100 restaurantes

- [ ] Event sourcing (ADR Opcion B+C)
- [ ] API publica
- [ ] App nativa comandero (React Native)
- [ ] Lealtad/puntos
- [ ] Compras y proveedores
- [ ] Traspasos inter-sucursal
- [ ] Analytics benchmarks
- [ ] SOC 2 / compliance

---

## Confidence Score

| Area | Score | Ultima validacion |
|---|---|---|
| Ventas/Ordenes | 90% | Code PASS |
| Cobro | 90% | Code PASS |
| Cocina/KDS | 85% | Code PASS |
| Impresion | 85% | Production PASS (AMALAY) |
| Corte/Caja | 85% | Code PASS |
| Facturacion | 0% | Bloqueado (IEPS + Facturama) |
| Inventario | 80% | Code PASS |
| Auditoria | 85% | Code PASS |
| Offline | 60% | Parcial (409 bug) |
| Concurrencia | 30% | No implementado |
| Hardware | 50% | Parcial (bridge OK, cajon/huella pendiente) |
| **Global** | **67%** | |

---

> Target: 95% confidence en todas las areas antes de cutover.
