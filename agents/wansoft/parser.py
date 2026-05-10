#!/usr/bin/env python3
"""Parse Wansoft "Reporte Ventas Por Mesero" XLSX and emit WhatsApp message."""

import re
import sys
import statistics
from datetime import date, datetime
from pathlib import Path

import openpyxl

EXCLUDE_MESEROS = {"APLICACIONES", "MESERO EVENTO"}

RESUMEN_SHEET = "Resumen de ventas por mesero"

MESES_ES = {
    1: "Ene", 2: "Feb", 3: "Mar", 4: "Abr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Ago", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dic",
}

MEDALS = ["🥇", "🥈", "🥉"]


def _short_name(full: str) -> str:
    """First two words of a name."""
    parts = full.strip().split()
    return " ".join(parts[:2])


def _fmt_money(val: float) -> str:
    """$1,234 — rounded peso, no decimals."""
    return f"${round(val):,}"


def _find_resumen_sheet(wb: openpyxl.Workbook):
    """Find the 'Resumen de ventas por mesero' sheet by name or fallback."""
    # Try exact match first
    if RESUMEN_SHEET in wb.sheetnames:
        return wb[RESUMEN_SHEET]
    # Case-insensitive search
    for name in wb.sheetnames:
        if "resumen" in name.lower() and "mesero" in name.lower():
            return wb[name]
    # Fallback: scan all sheets for the header pattern
    for name in wb.sheetnames:
        ws = wb[name]
        for row in ws.iter_rows(min_row=1, max_row=15, values_only=True):
            vals = [str(c).strip().lower() if c else "" for c in row]
            if "mesero" in vals and "promedio por persona" in " ".join(vals):
                return ws
    raise ValueError(
        f"No se encontro sheet de resumen. Sheets disponibles: {wb.sheetnames}"
    )


def _parse_sheet(wb: openpyxl.Workbook):
    """Parse resumen sheet. Returns list of dicts."""
    ws = _find_resumen_sheet(wb)

    # Find header row — look for cell containing "Mesero" as header
    header_row = None
    for row_idx, row in enumerate(
        ws.iter_rows(min_row=1, max_row=15, values_only=False), start=1
    ):
        for cell in row:
            if cell.value and str(cell.value).strip().lower() == "mesero":
                header_row = row_idx
                break
        if header_row:
            break

    if header_row is None:
        raise ValueError("No se encontro la fila de headers con 'Mesero'")

    # Read headers and build column map
    headers_raw = [c.value for c in ws[header_row]]
    col_map = {}
    for i, h in enumerate(headers_raw):
        if h is None:
            continue
        hl = str(h).strip().lower()
        if hl == "mesero":
            col_map["mesero"] = i
        elif hl == "total":
            col_map["total"] = i
        elif "persona" in hl and "promedio" not in hl:
            col_map["personas"] = i
        elif "promedio" in hl:
            col_map["promedio"] = i

    required = {"mesero", "total", "personas", "promedio"}
    missing = required - set(col_map.keys())
    if missing:
        raise ValueError(
            f"Columnas faltantes: {missing}. Headers: {headers_raw}"
        )

    rows = []
    for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
        mesero = row[col_map["mesero"]]
        if mesero is None or str(mesero).strip() == "":
            continue
        mesero_str = str(mesero).strip()
        if mesero_str.lower() in ("total", "totales", "gran total"):
            continue
        total_val = row[col_map["total"]]
        personas_val = row[col_map["personas"]]
        promedio_val = row[col_map["promedio"]]
        if total_val is None or personas_val is None:
            continue
        rows.append({
            "mesero": mesero_str,
            "total": float(total_val),
            "personas": int(float(personas_val)),
            "promedio": float(promedio_val),
        })

    return rows


def _extract_date(wb: openpyxl.Workbook):
    """Extract report date from metadata rows."""
    # Scan first 6 rows of every sheet for date patterns
    for name in wb.sheetnames:
        ws = wb[name]
        for row in ws.iter_rows(min_row=1, max_row=6, values_only=True):
            for cell in row:
                if cell is None:
                    continue
                if isinstance(cell, (datetime, date)):
                    return cell if isinstance(cell, date) else cell.date()
                s = str(cell)
                # "Reporte del: 2026-05-09 al 2026-05-09"
                for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
                    for match in re.findall(
                        r"\d{1,4}[/-]\d{1,2}[/-]\d{2,4}", s
                    ):
                        try:
                            return datetime.strptime(match, fmt).date()
                        except ValueError:
                            continue
    return None


def format_message(xlsx_path: str, report_type: str = "cierre") -> str:
    """Parse XLSX and return WhatsApp-formatted message.

    report_type: "cierre" (end-of-day complete) or "avance" (mid-day partial).
    """
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    rows = _parse_sheet(wb)
    report_date = _extract_date(wb)
    wb.close()

    if report_date is None:
        m = re.search(r"(\d{4})-?(\d{2})-?(\d{2})", Path(xlsx_path).stem)
        if m:
            report_date = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        else:
            report_date = date.today()

    # Filter out non-mesero rows
    filtered = [r for r in rows if r["mesero"] not in EXCLUDE_MESEROS]
    if not filtered:
        return "Sin datos de meseros para este dia."

    # Sort by promedio descending
    filtered.sort(key=lambda r: r["promedio"], reverse=True)

    # Totals across filtered meseros
    total_dia = sum(r["total"] for r in filtered)
    personas_dia = sum(r["personas"] for r in filtered)
    general_avg = total_dia / personas_dia if personas_dia else 0

    # Date formatting
    dd = f"{report_date.day:02d}"
    mes = MESES_ES[report_date.month]
    date_str = f"{dd} {mes}"

    # Header by report type
    if report_type == "avance":
        header = f"☀️ *AMALAY · Avance del día · {date_str} (3pm)*"
    else:
        header = f"🌙 *AMALAY · Cierre {date_str}*"

    # Build message
    lines = [header, ""]
    lines.append(f"Ticket promedio del día: {_fmt_money(general_avg)}")
    lines.append("")

    # Top 3
    top3 = filtered[:3]
    for i, r in enumerate(top3):
        medal = MEDALS[i]
        lines.append(
            f"{medal} {_short_name(r['mesero'])} {_fmt_money(r['promedio'])} "
            f"({r['personas']} mesas)"
        )

    # Rest
    rest = filtered[3:]
    if rest:
        lines.append("")
        lines.append("Resto:")
        for j in range(0, len(rest), 2):
            pair = rest[j:j + 2]
            parts = [
                f"{_short_name(r['mesero'])} {_fmt_money(r['promedio'])} ({r['personas']})"
                for r in pair
            ]
            lines.append("- " + " · ".join(parts))

    # Top volumen note
    personas_list = [r["personas"] for r in filtered]
    median_personas = statistics.median(personas_list)
    threshold = median_personas * 1.5
    high_vol = [r for r in filtered if r["personas"] > threshold]
    if high_vol:
        top_vol = max(high_vol, key=lambda r: r["personas"])
        lines.append("")
        lines.append(
            f"🏆 Top mesas: {_short_name(top_vol['mesero'])} ({top_vol['personas']})"
        )

    lines.append("")
    lines.append(f"Total día: {_fmt_money(total_dia)} · {personas_dia} personas")
    lines.append("")
    lines.append("_by Fullsite ✨_")

    # Footnote by report type
    if report_type == "avance":
        lines.append("_Datos parciales — al cierre llegará el resumen completo_")
    else:
        lines.append("_Promedios mezclan turnos brunch (mañana) y cafecito (tarde) — v2 separará por turno_")

    return "\n".join(lines)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Parse Wansoft XLSX → WhatsApp message")
    ap.add_argument("xlsx", help="Path to XLSX file")
    ap.add_argument("--type", dest="report_type", choices=["cierre", "avance"],
                    default="cierre", help="Report type (default: cierre)")
    args = ap.parse_args()

    if not Path(args.xlsx).exists():
        print(f"Error: archivo no encontrado: {args.xlsx}", file=sys.stderr)
        sys.exit(1)
    print(format_message(args.xlsx, report_type=args.report_type))
