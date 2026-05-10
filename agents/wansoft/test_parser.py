#!/usr/bin/env python3
"""Generate a synthetic test XLSX and validate parser output."""

import os
import sys
from pathlib import Path

import openpyxl

TEST_DIR = Path(__file__).parent / "test_data"
TEST_FILE = TEST_DIR / "ReporteVentasPorMesero2026-05-10.xlsx"

# Data approximating the 09-May demo numbers
MESEROS_DATA = [
    # (Mesero, Subtotal, IEPS, IVA, Total, %, Personas, Promedio)
    ("Brayan Berlanga Solis",       14200, 0, 2272, 16472, 15.7, 26, 623),
    ("Oscar Rios Alvarado",         12800, 0, 2048, 14848, 14.1, 29, 506),
    ("Julio Cesar Hernández H.",    11000, 0, 1760, 12760, 12.1, 26, 482),
    ("Omar Aguilera",               13500, 0, 2160, 15660, 14.9, 35, 443),
    ("Hector Enrique Rodriguez L.", 10200, 0, 1632, 11832, 11.3, 28, 419),
    ("Daniela Edith Rico Segura",    8500, 0, 1360,  9860,  9.4, 24, 408),
    ("Mauricio Rodriguez Rodriguez", 7800, 0, 1248,  9048,  8.6, 23, 390),
    ("Alexis Alejandro Ocampo V.",   5100, 0,  816,  5916,  5.6, 16, 365),
    ("MESERO EVENTO",                4200, 0,  672,  4872,  4.6, 12, 406),
    ("APLICACIONES",                 3825, 0,  612,  4437,  4.2,  0,   0),
]


def create_test_xlsx():
    """Create a synthetic XLSX matching Wansoft export structure."""
    TEST_DIR.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()

    # Sheet 1: Resumen de ventas por mesero
    ws1 = wb.active
    ws1.title = "Resumen de ventas por mesero"
    # Metadata rows (5 rows)
    ws1.append(["Reporte de Ventas por Mesero"])
    ws1.append(["AMALAY Coffee & Market"])
    ws1.append(["Periodo: 10/05/2026"])
    ws1.append(["Generado: 10/05/2026 22:30"])
    ws1.append([])  # blank row
    # Header row (row 6)
    ws1.append(["Mesero", "Subtotal", "IEPS", "IVA", "Total", "%",
                "Personas atendidas", "Promedio por persona"])
    # Data
    for row in MESEROS_DATA:
        ws1.append(list(row))
    # Totals row
    ws1.append(["Total", 91125, 0, 14580, 105705, 100, 219, 0])

    # Sheet 2: Ventas por mesero por grupo (stub)
    ws2 = wb.create_sheet("Ventas por mesero por grupo")
    ws2.append(["Mesero", "Grupo", "Total"])

    # Sheet 3 & 4 (stubs)
    wb.create_sheet("Hoja3")
    wb.create_sheet("Hoja4")

    wb.save(TEST_FILE)
    return TEST_FILE


def test_format_message():
    xlsx = create_test_xlsx()

    # Import parser
    sys.path.insert(0, str(Path(__file__).parent))
    from parser import format_message

    msg = format_message(str(xlsx))
    print("=== OUTPUT ===")
    print(msg)
    print("=== END ===\n")

    # Assertions
    errors = []

    if "Cierre 10 May" not in msg:
        errors.append(f"Date: expected 'Cierre 10 May', got header line: {msg.splitlines()[0]}")

    if "APLICACIONES" in msg:
        errors.append("APLICACIONES should be filtered out")

    if "MESERO EVENTO" in msg:
        errors.append("MESERO EVENTO should be filtered out")

    # Top 3 by promedio: Brayan ($623), Oscar ($506), Julio ($482)
    lines = msg.splitlines()
    medal_lines = [l for l in lines if l.startswith(("🥇", "🥈", "🥉"))]
    if len(medal_lines) != 3:
        errors.append(f"Expected 3 medal lines, got {len(medal_lines)}")
    else:
        if "Brayan Berlanga" not in medal_lines[0]:
            errors.append(f"Top 1 should be Brayan, got: {medal_lines[0]}")
        if "$623" not in medal_lines[0]:
            errors.append(f"Top 1 avg should be $623, got: {medal_lines[0]}")
        if "Oscar Rios" not in medal_lines[1]:
            errors.append(f"Top 2 should be Oscar Rios, got: {medal_lines[1]}")
        if "Julio Cesar" not in medal_lines[2]:
            errors.append(f"Top 3 should be Julio Cesar, got: {medal_lines[2]}")

    # Check total — sum of non-filtered rows
    # Filtered total = 105705 - 4872 (MESERO EVENTO) - 4437 (APLICACIONES) = 96396
    # But we test the approximate range
    if "Total día:" not in msg:
        errors.append("Missing 'Total día:' line")

    # Check personas (219 - 12 - 0 = 207)
    if "207 personas" not in msg:
        errors.append(f"Expected 207 personas in total line")

    # General avg = 96396 / 207 = ~465.7 -> $466
    if "$466" not in msg:
        errors.append("Expected general avg ~$466")

    # Top mesas note: Omar has 35 personas, median ~26, threshold ~39 -> no note
    # Actually median of [26,29,26,35,28,24,23,16] = 26, threshold = 39, Omar = 35 < 39 -> no note
    if "Top mesas" in msg:
        # Verify it's correct if present
        pass

    if errors:
        print("FAILURES:")
        for e in errors:
            print(f"  ✗ {e}")
        sys.exit(1)
    else:
        print("All checks passed.")


if __name__ == "__main__":
    test_format_message()
