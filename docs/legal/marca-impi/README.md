# Marca FULLSITE — IMPI

> Solicitud presentada el **2026-08-25**. Aquí viven el acuse y el comprobante de pago.
> Los datos están transcritos abajo **para que se puedan buscar sin abrir el PDF** — pero el
> PDF es la fuente; si algo no cuadra, gana el PDF.

## Estado

**Presentada, en estudio.** El IMPI todavía no resuelve. Un acuse de recibo **no es** un
registro concedido: sólo prueba que la solicitud entró con fecha y hora ciertas. Esa fecha es
lo que importa, porque fija la prioridad frente a cualquier solicitud posterior de un tercero.

Lo que sigue es el examen de forma y luego el de fondo. Puede salir un oficio pidiendo
aclaración (hay plazo para contestar, y se vence). Cuando llegue algo del IMPI, va a este
mismo directorio.

## Los datos

| Campo | Valor |
|---|---|
| Denominación | `FULLSITE.` (mixta — palabra + logo) |
| Clase de Niza | **42** |
| Cobertura | Servicios científicos y tecnológicos e investigación y diseño conexos; análisis e investigación industrial; control de calidad y autenticación; **diseño y desarrollo de hardware y software** |
| Expediente | `3692109` |
| Folio de recepción | `356914` |
| Trámite en línea | `20260367469` |
| Presentación | 2026-08-25 22:13:37 |
| Fecha de primer uso en México | *No se ha usado* (declarado en la solicitud) |
| Titular / solicitante | Daniel Ramonfaur Coindreau — **persona física** |
| Presentó el trámite | Andy Isaid Martínez Domínguez |
| Anexos | `fullsitelogo.gif` · comprobante de pago |

### Pago

| Campo | Valor |
|---|---|
| Folio FEPS | `10084927754` |
| Concepto | Tarifa 14a — estudio de solicitud nacional de registro de marca |
| Tarifa | $2,695.18 |
| Descuento (10%) | −$269.52 |
| Subtotal | $2,425.66 |
| IVA | $388.11 |
| **Total pagado** | **$2,813.77 MXN** |
| Pagado | 2026-08-25 22:11:20 · Bancomer, convenio 0662852 |

El FEPS **no es un comprobante fiscal**. La factura se emite dentro de los tres días hábiles
siguientes al pago — si no llegó, hay que reclamarla.

## Pendiente

- [ ] **La marca está a nombre de Daniel como persona física, no de FULLSITE SAS.** La sociedad
      quedó constituida el 2026-06-11 (folio SAS20261025053). Mientras la marca viva fuera de
      la sociedad, la empresa no es dueña de su propio nombre: en un due diligence eso sale, y
      arreglarlo después cuesta una cesión de derechos ante el IMPI. Se puede ceder una vez
      concedida, o corregir antes según lo que aconseje quien llevó el trámite.
- [ ] Factura del pago (tres días hábiles a partir del 2026-08-25).
- [ ] Vigilar el buzón del domicilio de notificaciones — Río Sena 1214, Col. Central,
      Monterrey. Los plazos del IMPI corren desde la notificación, no desde que uno se entera.

## Dónde están los PDF

**No en el repo.** Viven con el resto de lo legal, en `~/Desktop/SAT-Fullsite/`:

| Archivo | Qué es |
|---|---|
| `IMPI-Marca-FULLSITE-Acuse-Solicitud-Clase42-2026-08-25.pdf` | Acuse del IMPI + solicitud completa (5 págs). Trae el sello digital. |
| `IMPI-Marca-FULLSITE-Pago-FEPS-10084927754-2026-08-25.pdf` | Comprobante Electrónico de Pagos por Servicios. |

Llegaron por WhatsApp el 2026-08-25 y se copiaron sin modificar (`cmp` idéntico byte por byte).
SHA-256:

    fe3315cea20a9da52cbad12f126e21526514c90f1ae95f3aa49ebbed35a9f62e  acuse
    108a3e4d9521a8acb8f488843c65de8b46189fc6ea112f9324f5b5ef4c57bdb8  pago FEPS

Se quedan fuera de git a propósito: la página 2 del acuse trae el domicilio particular y el
teléfono de Daniel, y del historial de git eso ya no sale. El registro de marca en sí es
público una vez concedido; los datos de contacto del solicitante, no.
