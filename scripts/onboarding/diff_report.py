#!/usr/bin/env python3
"""
diff_report.py — Migration Diff Report.

Compares the menu currently in Supabase against the source CSV
and generates an HTML report for the gerente to review and sign off.

Replaces 1-2 hours of manual item-by-item comparison (Onboarding §2D rule:
"Verificar con gerente item por item (Migration Diff Report)").

This is a gate — no go-live until the gerente approves this report.

Usage:
    python3 scripts/onboarding/diff_report.py \\
        --client-id  grupo-galeria-dunkin \\
        --source     menus/dunkin-menu.csv \\
        --output     reports/dunkin-diff-2026-08-03.html \\
        --confirm-ref <project-ref>

Environment:
    NEXT_PUBLIC_SUPABASE_URL  https://<ref>.supabase.co
    SUPABASE_SERVICE_KEY      service_role key
"""
import argparse
import csv
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from contract import Result, verify_ref

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE
JWT_PAT = re.compile(r'eyJ[A-Za-z0-9_\-\.]{50,}')


def redact(s):
    return JWT_PAT.sub("***REDACTED***", str(s))


def _req(method, url, body, headers, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else [])
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except (urllib.error.URLError, OSError) as e:
        return 0, str(e)


def get(url, h):
    return _req("GET", url, None, h)


def parse_csv(path):
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            row = {k.lower().strip(): v.strip() for k, v in row.items()}
            cat  = row.get("category", "").strip()
            name = row.get("name", "").strip()
            price_str = row.get("price", "0").strip()
            if not cat or not name:
                continue
            try:
                price = round(float(price_str), 2)
            except ValueError:
                price = 0.0
            active = row.get("active", "true").strip().lower() != "false"
            rows.append({"category": cat, "name": name, "price": price, "active": active})
    return rows


def fetch_db_items(rest, client_id, svc_h):
    """Returns list of {category, name, price, active} from DB."""
    enc = urllib.parse.quote(client_id)
    # Fetch categories
    s, cats = get(
        f"{rest}/pos_menu_categories?client_id=eq.{enc}&select=id,name&limit=500",
        svc_h)
    if s != 200 or not isinstance(cats, list):
        return []
    cat_map = {c["id"]: c["name"] for c in cats}

    # Fetch items
    s, items = get(
        f"{rest}/pos_menu_items?client_id=eq.{enc}&select=id,category_id,name,price,active&limit=2000",
        svc_h)
    if s != 200 or not isinstance(items, list):
        return []

    return [
        {
            "category": cat_map.get(i["category_id"], "?"),
            "name": i["name"],
            "price": round(float(i["price"]), 2),
            "active": i.get("active", True),
        }
        for i in items
    ]


def diff(csv_rows, db_rows):
    """
    Returns:
      matched   — in both, price OK
      price_diff — in both, price different
      missing_in_db  — in CSV but not in DB
      extra_in_db    — in DB but not in CSV
    """
    csv_index = {(r["category"], r["name"]): r for r in csv_rows}
    db_index  = {(r["category"], r["name"]): r for r in db_rows}

    matched      = []
    price_diff   = []
    missing_in_db = []
    extra_in_db   = []

    for key, csv_row in csv_index.items():
        if key in db_index:
            db_row = db_index[key]
            if abs(csv_row["price"] - db_row["price"]) < 0.01:
                matched.append({"csv": csv_row, "db": db_row})
            else:
                price_diff.append({"csv": csv_row, "db": db_row})
        else:
            missing_in_db.append(csv_row)

    for key, db_row in db_index.items():
        if key not in csv_index:
            extra_in_db.append(db_row)

    return matched, price_diff, missing_in_db, extra_in_db


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_html(client_id, csv_path, matched, price_diff, missing_in_db, extra_in_db,
                csv_count, db_count):
    total_issues = len(price_diff) + len(missing_in_db) + len(extra_in_db)
    status_color = "#2A7A52" if total_issues == 0 else "#C05050"
    status_label = "LISTO PARA GO-LIVE" if total_issues == 0 else f"{total_issues} PROBLEMA(S) — NO IR A GO-LIVE"
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())

    def table_rows(rows_data, cols):
        if not rows_data:
            return '<tr><td colspan="99" style="color:#4A6A8A;text-align:center;padding:12px">Ninguno</td></tr>'
        out = []
        for rd in rows_data:
            cells = "".join(f"<td>{esc(rd.get(c,''))}</td>" for c in cols)
            out.append(f"<tr>{cells}</tr>")
        return "\n".join(out)

    price_rows = ""
    for r in price_diff:
        diff_val = r["db"]["price"] - r["csv"]["price"]
        sign = "+" if diff_val > 0 else ""
        price_rows += (
            f'<tr>'
            f'<td>{esc(r["csv"]["category"])}</td>'
            f'<td>{esc(r["csv"]["name"])}</td>'
            f'<td style="color:#D4892A">${r["csv"]["price"]:.2f}</td>'
            f'<td style="color:#C05050">${r["db"]["price"]:.2f}</td>'
            f'<td style="color:#C05050">{sign}${diff_val:.2f}</td>'
            f'</tr>\n'
        )

    missing_rows = ""
    for r in missing_in_db:
        missing_rows += (
            f'<tr>'
            f'<td>{esc(r["category"])}</td>'
            f'<td>{esc(r["name"])}</td>'
            f'<td>${r["price"]:.2f}</td>'
            f'</tr>\n'
        )

    extra_rows = ""
    for r in extra_in_db:
        extra_rows += (
            f'<tr>'
            f'<td>{esc(r["category"])}</td>'
            f'<td>{esc(r["name"])}</td>'
            f'<td>${r["price"]:.2f}</td>'
            f'</tr>\n'
        )

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Diff Report — {esc(client_id)}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  background:#0A0F18;color:#B8CDE0;font-size:13px;line-height:1.5;
  font-variant-numeric:tabular-nums}}
.hd{{background:#111C2C;border-bottom:1px solid #1E3050;
  padding:16px 24px;display:flex;align-items:center;gap:16px;
  justify-content:space-between}}
.hd-left h1{{font-size:15px;font-weight:600}}
.hd-left p{{font-size:11px;color:#4A6A8A;margin-top:2px}}
.status-badge{{padding:6px 14px;border-radius:4px;font-size:11px;font-weight:700;
  letter-spacing:.06em;background:{status_color}22;
  border:1px solid {status_color}55;color:{status_color}}}
.stats{{display:grid;grid-template-columns:repeat(5,1fr);
  border-bottom:1px solid #1E3050}}
.stat{{padding:14px 20px;border-right:1px solid #1E3050}}
.stat:last-child{{border-right:none}}
.stat .n{{font-size:22px;font-weight:700;letter-spacing:-0.03em;line-height:1}}
.stat .l{{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#4A6A8A;margin-top:3px}}
.n-ok{{color:#3AAA72}}.n-warn{{color:#D4892A}}.n-err{{color:#C05050}}
.sec{{padding:16px 24px 8px}}
.sec h2{{font-size:12px;font-weight:600;text-transform:uppercase;
  letter-spacing:.06em;color:#4A6A8A;margin-bottom:10px}}
.tbl-wrap{{overflow-x:auto;padding:0 24px 16px}}
table{{width:100%;border-collapse:collapse;min-width:500px}}
th{{background:#111C2C;border-bottom:1px solid #263D5C;padding:7px 10px;
  text-align:left;font-size:10px;font-weight:600;letter-spacing:.06em;
  text-transform:uppercase;color:#4A6A8A;white-space:nowrap}}
td{{padding:7px 10px;border-bottom:1px solid #1E3050;font-size:12px}}
tr:hover td{{background:#172337}}
.footer{{padding:16px 24px;background:#111C2C;border-top:1px solid #1E3050;
  display:flex;justify-content:space-between;align-items:center;
  font-size:11px;color:#4A6A8A}}
.sign-box{{background:#172337;border:1px dashed #1E3050;
  padding:16px 24px;margin:12px 24px;border-radius:4px;
  display:flex;align-items:center;justify-content:space-between}}
.sign-box p{{font-size:12px;color:#4A6A8A}}
.sign-line{{border-top:1px solid #4A6A8A;width:200px;margin-top:24px;padding-top:6px;
  font-size:10px;color:#2A4060;text-align:center}}
</style>
</head>
<body>
<div class="hd">
  <div class="hd-left">
    <h1>Migration Diff Report — {esc(client_id)}</h1>
    <p>Fuente: {esc(csv_path)} · Generado: {timestamp}</p>
  </div>
  <div class="status-badge">{status_label}</div>
</div>

<div class="stats">
  <div class="stat"><div class="n n-ok">{csv_count}</div><div class="l">Items en CSV</div></div>
  <div class="stat"><div class="n n-ok">{db_count}</div><div class="l">Items en BD</div></div>
  <div class="stat"><div class="n n-ok">{len(matched)}</div><div class="l">Coincidencias exactas</div></div>
  <div class="stat"><div class="n {'n-warn' if price_diff else 'n-ok'}">{len(price_diff)}</div><div class="l">Precios distintos</div></div>
  <div class="stat"><div class="n {'n-err' if (missing_in_db or extra_in_db) else 'n-ok'}">{len(missing_in_db)+len(extra_in_db)}</div><div class="l">Faltantes / extras</div></div>
</div>

{'<div class="sec"><h2>Precios distintos — corregir antes de go-live</h2></div><div class="tbl-wrap"><table><thead><tr><th>Categoría</th><th>Platillo</th><th>Precio CSV</th><th>Precio BD</th><th>Diferencia</th></tr></thead><tbody>' + price_rows + '</tbody></table></div>' if price_diff else ''}

{'<div class="sec"><h2>En CSV pero NO en BD — faltantes en importación</h2></div><div class="tbl-wrap"><table><thead><tr><th>Categoría</th><th>Platillo</th><th>Precio CSV</th></tr></thead><tbody>' + missing_rows + '</tbody></table></div>' if missing_in_db else ''}

{'<div class="sec"><h2>En BD pero NO en CSV — extras (eliminar o confirmar)</h2></div><div class="tbl-wrap"><table><thead><tr><th>Categoría</th><th>Platillo</th><th>Precio BD</th></tr></thead><tbody>' + extra_rows + '</tbody></table></div>' if extra_in_db else ''}

<div class="sign-box">
  <div>
    <p style="font-size:13px;color:#B8CDE0;font-weight:600">Aprobación del Gerente</p>
    <p>Al firmar confirma que el menú en sistema coincide con el menú físico del restaurante.</p>
    <p style="margin-top:8px">Estatus: <strong style="color:{status_color}">{status_label}</strong></p>
  </div>
  <div style="display:flex;gap:40px">
    <div>
      <div class="sign-line">Firma del Gerente</div>
    </div>
    <div>
      <div class="sign-line">Fecha de aprobación</div>
    </div>
  </div>
</div>

<div class="footer">
  <span>Fullsite — Migration Diff Report · {esc(client_id)}</span>
  <span>No hacer go-live hasta que el gerente firme este documento.</span>
</div>
</body>
</html>"""


def run(args):
    client_id  = args.client_id
    csv_path   = args.source
    output     = args.output

    result = Result("diff_report")

    url     = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    svc_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url:
        result.error("NEXT_PUBLIC_SUPABASE_URL vacío")
    if not svc_key:
        result.error("SUPABASE_SERVICE_KEY vacío")
    if not Path(csv_path).exists():
        result.error(f"CSV no encontrado: {csv_path}")
    if result.errors:
        result.finish()
        return

    verify_ref(url, args.confirm_ref)

    svc_h = {"apikey": svc_key, "Authorization": f"Bearer {svc_key}"}
    rest  = f"{url}/rest/v1"

    print(f"\n── 1 · Parsing CSV ─────────────────────────────────────────────")
    csv_rows = parse_csv(csv_path)
    print(f"  ✓ {len(csv_rows)} items en CSV")

    print(f"\n── 2 · Leyendo menú de BD ──────────────────────────────────────")
    db_rows = fetch_db_items(rest, client_id, svc_h)
    print(f"  ✓ {len(db_rows)} items en BD para client_id='{client_id}'")

    print(f"\n── 3 · Calculando diff ─────────────────────────────────────────")
    matched, price_diff, missing_in_db, extra_in_db = diff(csv_rows, db_rows)

    print(f"  ✓ Coincidencias exactas:  {len(matched)}")
    print(f"  {'~' if price_diff else '✓'} Precios distintos:      {len(price_diff)}")
    print(f"  {'✗' if missing_in_db else '✓'} Faltantes en BD:        {len(missing_in_db)}")
    print(f"  {'~' if extra_in_db else '✓'} Extras en BD:           {len(extra_in_db)}")

    print(f"\n── 4 · Generando reporte ───────────────────────────────────────")
    html = render_html(client_id, csv_path, matched, price_diff, missing_in_db,
                       extra_in_db, len(csv_rows), len(db_rows))
    out_path = Path(output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    print(f"  ✓ Reporte generado: {out_path}")

    total_issues = len(price_diff) + len(missing_in_db) + len(extra_in_db)
    result.created = len(matched)
    for _ in price_diff:
        result.warn(f"precio distinto: {_['csv']['category']} / {_['csv']['name']} "
                    f"CSV=${_['csv']['price']:.2f} BD=${_['db']['price']:.2f}")
    for r in missing_in_db:
        result.error(f"faltante en BD: {r['category']} / {r['name']}")
    for r in extra_in_db:
        result.warn(f"extra en BD (no en CSV): {r['category']} / {r['name']}")

    print(f"\n{'═'*68}")
    if total_issues == 0:
        print(f"  ✓ LISTO PARA GO-LIVE — menú coincide exactamente con CSV")
    else:
        print(f"  ✗ {total_issues} problema(s) — resolver antes de go-live")
        print(f"    Ver: {out_path}")
    print(f"{'═'*68}")
    print(f"  Siguiente paso: compartir {out_path} con el gerente para su firma")

    result.finish(exit_on_fail=False)
    if result.errors:
        sys.exit(1)


def main():
    p = argparse.ArgumentParser(
        description="Generar Migration Diff Report — gate obligatorio antes de go-live"
    )
    p.add_argument("--client-id",   required=True)
    p.add_argument("--source",      required=True, help="CSV fuente (mismo usado en menu_import.py)")
    p.add_argument("--output",      required=True, help="Ruta de salida del HTML")
    p.add_argument("--confirm-ref", required=True)
    args = p.parse_args()
    try:
        run(args)
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
