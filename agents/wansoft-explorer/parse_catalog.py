"""Parsea los XLSX del catálogo Wansoft a JSON normalizado.

Uso: python parse_catalog.py <dir_xlsx> <out.json>
Espera archivos: platillos.xlsx, modificadores.xlsx, asignacion-modificadores.xlsx
(o los nombres largos del crawl de mayo), grupos.xlsx.
"""

import json
import sys
import unicodedata

import openpyxl


def find_file(d, *cands):
    import os
    for c in cands:
        p = os.path.join(d, c)
        if os.path.exists(p):
            return p
    return None


def rows_from(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    return list(ws.iter_rows(values_only=True))


def find_header(rows, key):
    for i, r in enumerate(rows):
        if r and key in [c for c in r if c]:
            return i
    raise ValueError(f"header '{key}' not found")


def cells(row, idx_map):
    return {k: row[i] for k, i in idx_map.items()}


def idx_of(rows, hdr_i):
    return {str(c).strip(): i for i, c in enumerate(rows[hdr_i]) if c}


def clean(s):
    if s is None:
        return None
    return str(s).strip()


def parse_grupos(path):
    rows = rows_from(path)
    h = find_header(rows, "Tipo")
    ix = idx_of(rows, h)
    out = []
    for r in rows[h + 1:]:
        if not r or r[ix["Nombre"]] is None:
            continue
        out.append({
            "tipo": clean(r[ix["Tipo"]]),
            "clave": clean(r[ix["Clave"]]),
            "nombre": clean(r[ix["Nombre"]]),
            "orden": r[ix["Orden"]] or 0,
        })
    return out


def parse_platillos(path):
    rows = rows_from(path)
    h = find_header(rows, "Grupo")
    ix = idx_of(rows, h)
    out = []
    for r in rows[h + 1:]:
        if not r or r[ix["Nombre"]] is None:
            continue
        out.append({
            "grupo": clean(r[ix["Grupo"]]),
            "clave": clean(r[ix["Clave"]]),
            "nombre": clean(r[ix["Nombre"]]),
            "precio": r[ix["Precio1"]] or 0,
            "con_iva": clean(r.get if False else r[ix["Con IVA"]]) if "Con IVA" in ix else None,
            "aplica_2x1": clean(r[ix["Aplica 2x1"]]) if "Aplica 2x1" in ix else None,
            "aplica_cortesia": clean(r[ix["Aplica cortesía"]]) if "Aplica cortesía" in ix else None,
            "aplica_descuento": clean(r[ix["Aplica descuento"]]) if "Aplica descuento" in ix else None,
            "incluir_en_pv": clean(r[ix["Incluir en PV"]]) if "Incluir en PV" in ix else None,
            "orden": r[ix["Orden"]] if "Orden" in ix else 0,
        })
    return out


def parse_modificadores(path):
    rows = rows_from(path)
    h = find_header(rows, "Grupo")
    ix = idx_of(rows, h)
    out = []
    for r in rows[h + 1:]:
        if not r or r[ix["Nombre"]] is None:
            continue
        out.append({
            "grupo": clean(r[ix["Grupo"]]),
            "clave": clean(r[ix["Clave"]]),
            "nombre": clean(r[ix["Nombre"]]),
            "precio": r[ix["Precio1"]] or 0,
            "orden": r[ix["Orden"]] if "Orden" in ix else 0,
        })
    return out


def parse_asignaciones(path):
    """Platillo, Modificador, Nivel, Nombre nivel, Requerido, Bloquear selección,
    Modificadores por nivel (= Cantidad mínima, Cantidad máxima en 2 cols)."""
    rows = rows_from(path)
    h = find_header(rows, "Platillo")
    ix = idx_of(rows, h)
    # la fila siguiente trae 'Cantidad mínima'/'Cantidad máxima' bajo 'Modificadores por nivel'
    base = ix["Modificadores por nivel"]
    sub = rows[h + 1]
    min_i, max_i = base, base + 1
    if sub and clean(sub[base]) and "mín" in str(sub[base]).lower():
        pass  # confirmado
    out = []
    for r in rows[h + 2:]:
        if not r or r[ix["Platillo"]] is None:
            continue
        out.append({
            "platillo": clean(r[ix["Platillo"]]),
            "modificador": clean(r[ix["Modificador"]]),
            "nivel": r[ix["Nivel"]],
            "nombre_nivel": clean(r[ix["Nombre nivel"]]),
            "requerido": clean(r[ix["Requerido"]]) == "Si",
            "bloquear": clean(r[ix["Bloquear selección"]]) == "Si",
            "min": r[min_i] if r[min_i] is not None else 0,
            "max": r[max_i],
        })
    return out


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "output/catalog_fresh"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "output/catalog_normalized.json"

    f_plat = find_file(d, "platillos.xlsx", "punto-de-venta-restaurante-platillos.xlsx")
    f_mod = find_file(d, "modificadores.xlsx", "punto-de-venta-restaurante-modificadores.xlsx")
    f_asig = find_file(d, "asignacion-modificadores.xlsx",
                       "punto-de-venta-restaurante-asignacion-de-modificadores.xlsx")
    f_grp = find_file(d, "grupos.xlsx", "punto-de-venta-restaurante-grupos.xlsx")

    result = {
        "grupos": parse_grupos(f_grp) if f_grp else [],
        "platillos": parse_platillos(f_plat) if f_plat else [],
        "modificadores": parse_modificadores(f_mod) if f_mod else [],
        "asignaciones": parse_asignaciones(f_asig) if f_asig else [],
    }

    # niveles únicos derivados de asignaciones: (nombre_nivel, nivel, min, max, requerido)
    niveles = {}
    for a in result["asignaciones"]:
        key = (a["nombre_nivel"], a["nivel"], a["min"], a["max"], a["requerido"])
        niveles.setdefault(key, {"platillos": set(), "modificadores": set()})
        niveles[key]["platillos"].add(a["platillo"])
        niveles[key]["modificadores"].add(a["modificador"])
    result["niveles_resumen"] = [
        {
            "nombre_nivel": k[0], "nivel": k[1], "min": k[2], "max": k[3],
            "requerido": k[4],
            "n_platillos": len(v["platillos"]), "n_modificadores": len(v["modificadores"]),
        }
        for k, v in sorted(niveles.items(), key=lambda x: str(x[0][0]))
    ]

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)

    print(f"grupos: {len(result['grupos'])}")
    print(f"platillos: {len(result['platillos'])}")
    print(f"modificadores: {len(result['modificadores'])}")
    print(f"asignaciones: {len(result['asignaciones'])}")
    print(f"niveles únicos: {len(result['niveles_resumen'])}")
    print(f"-> {out_path}")


if __name__ == "__main__":
    main()
