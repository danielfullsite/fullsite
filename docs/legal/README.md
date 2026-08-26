# Legales — Fullsite

**Índice** de lo legal de la empresa. Los expedientes con datos personales no viven aquí —
viven en `~/Desktop/SAT-Fullsite/` y este directorio dice qué son y dónde están, para poder
encontrarlos con `rg` sin abrir un PDF.

| Qué | Dónde | Estado |
|---|---|---|
| Marca `FULLSITE.` ante el IMPI, clase 42 | [`marca-impi/`](marca-impi/) → PDF en `SAT-Fullsite/` | Presentada 2026-08-25 · en estudio |
| Acta constitutiva SAS + boleta RPC | `SAT-Fullsite/` | Firmada 2026-06-11 |
| Constancia de situación fiscal | `SAT-Fullsite/` | RFC `FTE260611PI8` |
| LOI Fullsite ↔ Grupo Galería | [`loi-fullsite-grupo-galeria.html`](loi-fullsite-grupo-galeria.html) | Firmada 2026-07-28 |

## Los originales viven fuera del repo

`~/Desktop/SAT-Fullsite/` es la carpeta madre de lo legal y fiscal: acta constitutiva SAS
firmada, boleta del RPC, constancia de situación fiscal, INE, relación de socios, y ahora
el acuse y el pago de la marca.

**Esa carpeta no se sincroniza con git y no debe hacerlo**, porque además de documentos
contiene la e.firma y el CSD — llaves privadas. Ver la nota de seguridad abajo.

## La entidad

| | |
|---|---|
| Razón social | **FULLSITE TECHNOLOGIES** |
| Tipo | **SAS** (Sociedad por Acciones Simplificada), no S.A. de C.V. |
| RFC | `FTE260611PI8` |
| Constituida | 2026-06-11 · folio `SAS20261025053` |

> El SAQ A en [`../security/policies/11-pci-dss-saq-a.md`](../security/policies/11-pci-dss-saq-a.md)
> dice "Fullsite Technologies S.A. de C.V.". El tipo societario está mal ahí: es SAS. Si ese
> documento se le manda a un cliente o a un auditor, hay que corregirlo antes.

## Nota de seguridad

`~/Desktop/SAT-Fullsite/` guarda `FIEL.key`, `CSD-Sellos.key` y un archivo de pistas de
contraseña, sin cifrar, en el Escritorio. La e.firma firma **a nombre de la sociedad** ante
el SAT: quien tenga esa llave y su contraseña puede actuar como la empresa. Merece disco
cifrado o un gestor de contraseñas, no el Escritorio.

## Reglas

- **Ningún PDF con datos personales entra a git.** Del historial de git no se borra nada
  fácilmente. Los originales se quedan en la carpeta; aquí sólo va el índice.
- Nada de credenciales, tokens, llaves ni contraseñas — ni en un archivo ni en un índice.
- Cada carpeta lleva un `README.md` que transcribe los datos clave, para que se puedan
  buscar con `rg` sin abrir un PDF. El PDF sigue siendo la fuente.
- Al copiar un original se renombra con fecha adelante, se verifica con `cmp` que quedó
  idéntico, y el SHA-256 queda escrito en el índice.
