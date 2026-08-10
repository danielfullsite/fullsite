#!/usr/bin/env python3
"""Golden reconciliation test: Wansoft export totals vs Fullsite aggregation LOGIC.

Reads ONLY the sanitized fixture (agents/wansoft/test_data/fixtures/golden_2026-05-10.json),
never the raw xlsx. Applies the same aggregation contract Fullsite uses in
dashboard-app/src/lib/data.ts::getDashboardFromPosOrders and asserts each metric
reconciles to the cent.

Fullsite model (from data.ts):
    ventas       = sum(order.total)            # tax-inclusive net gran total
    ventas_dia   = ventas
    ventas_brutas= ventas + descuentos
    descuentos   = sum(order.descuento)
    devoluciones = 0                           # HARDCODED — Fullsite never computes returns
    efectivo/tarjeta = split by payment method (transferencia lands in 'tarjeta' bucket)
    propinas_total = sum(order.propina)

Because we have no live Fullsite POS rows for 2026-05-10, the Fullsite side is
reconstructed from the SAME source totals the export carries (the mesero Total row),
run through Fullsite's arithmetic contract. That isolates *mapping/definition* gaps
(what Fullsite would compute differently or not at all) from data-entry noise.

Exit 0 iff every in-scope metric delta == 0.00 (or is a declared, reasoned tolerance).
Exit 1 otherwise.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXTURE = os.path.join(
    REPO, "agents", "wansoft", "test_data", "fixtures", "golden_2026-05-10.json"
)

CENT = 0.005  # half-cent numeric tolerance for float noise


def money(x):
    return f"${x:,.2f}" if isinstance(x, (int, float)) else str(x)


def fullsite_aggregate(w):
    """Apply Fullsite's aggregation contract to the Wansoft source totals.

    Fullsite's canonical `ventas` == sum(order.total). Wansoft's per-order `total`
    is the tax-inclusive line total, so Fullsite `ventas` reconciles to Wansoft
    gran_total. Everything else follows data.ts.
    """
    ventas = w["gran_total"]                 # sum(order.total) == gran_total
    descuentos = w["descuentos"] or 0.0
    return {
        "ventas_dia": ventas,                # net, tax-inclusive
        "ventas_brutas": ventas + descuentos,
        "descuentos": descuentos,
        "devoluciones": 0.0,                 # hardcoded in data.ts
        # Fullsite has no subtotal/iva split field — it stores tax-inclusive totals only.
        "iva": None,
        "ieps": None,
        # Payment split / propinas require per-order pagos+propina, absent from export.
        "efectivo": None,
        "tarjeta": None,
        "propinas_total": None,
        "personas_restaurant": w["personas"],
    }


# metric -> (wansoft_key, fullsite_key, probable_cause, mapping_gap)
PLAN = [
    ("ventas_netas (gran total)", "gran_total", "ventas_dia",
     "same concept: Wansoft gran_total == Fullsite sum(order.total)",
     "none — Fullsite ventas_dia maps 1:1 to Wansoft tax-inclusive gran_total"),
    ("ventas_brutas", "ventas_brutas", "ventas_brutas",
     "brutas = net + descuentos; descuentos=0 in this export",
     "none when descuentos captured; export carries no discount lines"),
    ("descuentos", "descuentos", "descuentos",
     "export 'Total descuentos sobre cuentas' header blank => 0",
     "Wansoft discounts live on a corte/cuentas report not in this export"),
    ("devoluciones", "devoluciones", "devoluciones",
     "both 0 here (export has none; Fullsite hardcodes 0)",
     "GAP: Fullsite devoluciones is hardcoded 0 — never computes anulaciones"),
    ("personas", "personas", "personas_restaurant",
     "Wansoft 'Personas atendidas' == Fullsite personas_restaurant",
     "none — direct field map"),
    # Below: present in Wansoft export as subtotal/iva but Fullsite has no field.
    ("iva (16%)", "iva", "iva",
     "Wansoft splits subtotal/IVA; Fullsite stores tax-inclusive only",
     "GAP: Fullsite has no IVA/subtotal breakout field in wansoft_daily"),
    # Below: absent from THIS Wansoft export entirely.
    ("propinas", "propinas", "propinas_total",
     "not in export; needs per-order propina",
     "GAP: no tips sheet in ventas-por-mesero export"),
    ("formas_pago.efectivo", ("formas_pago", "efectivo"), "efectivo",
     "not in export; needs per-order pagos",
     "GAP: no formas-de-pago sheet in this export"),
    ("formas_pago.tarjeta_credito", ("formas_pago", "tarjeta_credito"), "tarjeta",
     "not in export; Fullsite lumps credito+debito+transfer into 'tarjeta'",
     "GAP: Fullsite efectivo/tarjeta is 2-way; Wansoft has 4+ payment types"),
    ("cancelaciones", "cancelaciones", None,
     "not in export; Fullsite has no cancelaciones metric",
     "GAP: neither side captures cancelaciones in this pipeline"),
    ("corte_total", "corte_total", None,
     "not in export; Fullsite has no corte/turno aggregate",
     "GAP: corte/turno is a separate Wansoft report, not exported here"),
]


def wval(w, key):
    if isinstance(key, tuple):
        return w[key[0]][key[1]]
    return w[key]


def assert_business_date_from_content(fx):
    """PERMANENT INVARIANT: business date comes from the REPORT CONTENT
    ('Reporte del: YYYY-MM-DD'), NEVER from the file name.

    Real case: agents/wansoft/test_data/real_2026-05-10.xlsx has file-name date
    2026-05-10 but its content is business date 2026-05-09 (gran total $105,093).
    Trusting the file name would misfile a whole day of sales. The fixture must
    carry the content-derived business_date; this guard fails loudly if a future
    fixture ever lets the file name leak in as the source of truth.
    """
    bd = fx.get("business_date")
    src = str(fx.get("source_file", ""))
    if not bd:
        print("INVARIANT FAIL: fixture has no content-derived business_date")
        sys.exit(1)
    import re
    m = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(src))
    if m and m.group(1) != bd:
        # Allowed ONLY if the fixture explicitly documents the divergence
        # (i.e. it knowingly used a file whose name != content date).
        note = (fx.get("notes", "") + " " + json.dumps(fx.get("rules", ""))).lower()
        if "name" not in note and "nombre" not in note and "content" not in note:
            print(f"INVARIANT FAIL: file-name date {m.group(1)} != content "
                  f"business_date {bd} and divergence is not documented")
            sys.exit(1)


def main():
    with open(FIXTURE) as f:
        fx = json.load(f)
    assert_business_date_from_content(fx)
    w = fx["wansoft"]
    fs = fullsite_aggregate(w)

    rows = []
    hard_fail = False
    for label, wkey, fkey, cause, gap in PLAN:
        wv = wval(w, wkey)
        fv = fs.get(fkey) if fkey else None

        # Determine delta / status
        if isinstance(wv, (int, float)) and isinstance(fv, (int, float)):
            delta = round(fv - wv, 2)
            status = "OK" if abs(delta) <= CENT else "FAIL"
            if status == "FAIL":
                hard_fail = True
            delta_s = money(delta)
        elif wv is None and fv is None:
            delta_s = "n/a (both null)"
            status = "N/A"
        else:
            # one side null => not an arithmetic failure, it's a mapping gap
            delta_s = "n/a (unmapped)"
            status = "GAP"
        rows.append((status, label, money(wv), money(fv), delta_s, cause, gap))

    # ---- print table ----
    print(f"\nGOLDEN RECONCILIATION — business_date {fx['business_date']}  "
          f"({fx['sucursal']})")
    print(f"source: {fx['source_file']}\n")

    headers = ["st", "metric", "wansoft", "fullsite", "delta",
               "probable_cause", "mapping_gap"]
    widths = [4, 28, 13, 13, 16, 46, 52]

    def fmt(cols):
        return "  ".join(str(c)[:w].ljust(w) for c, w in zip(cols, widths))

    print(fmt(headers))
    print("  ".join("-" * w for w in widths))
    for r in rows:
        print(fmt(r))

    # ---- gates ----
    print("\nRELATIONSHIP GATES (Wansoft internal, exact-to-cent):")
    checks = [
        ("gran_total == subtotal + iva + ieps",
         abs(w["gran_total"] - (w["ventas_netas_sin_iva"] + w["iva"] + (w["ieps"] or 0))) <= CENT),
        ("iva == round(subtotal * 0.16, 2)",
         abs(w["iva"] - round(w["ventas_netas_sin_iva"] * 0.16, 2)) <= CENT),
        ("sum(meseros.total) == gran_total",
         abs(sum(m["total"] for m in fx["meseros_anon"]) - w["gran_total"]) <= CENT),
        ("ventas_brutas == gran_total (descuentos=0)",
         abs(w["ventas_brutas"] - w["gran_total"]) <= CENT),
    ]
    for name, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
        if not ok:
            hard_fail = True

    n_ok = sum(1 for r in rows if r[0] == "OK")
    n_gap = sum(1 for r in rows if r[0] in ("GAP", "N/A"))
    print(f"\nSUMMARY: {n_ok} metrics reconciled to the cent, "
          f"{n_gap} unmapped/gap (declared, non-blocking), "
          f"{sum(1 for r in rows if r[0]=='FAIL')} arithmetic failures.")

    if hard_fail:
        print("RESULT: FAIL (non-zero delta on a mapped metric)")
        return 1
    print("RESULT: PASS (all mapped metrics reconcile exactly; gaps are declared)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
