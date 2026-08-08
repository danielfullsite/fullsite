#!/usr/bin/env python3
"""W1-C: genera fixtures de paridad TS <-> Python para business date.

La implementacion Python (ops_aggregate.py) es la REFERENCIA de comportamiento.
Este script la ejecuta sobre casos limite y escribe los resultados esperados a
un JSON que la suite TS (w1c-business-date.test.ts) verifica 1:1.

Uso:  python3 scripts/wave1/w1c_parity_gen.py
Salida: dashboard-app/src/__tests__/fixtures/w1c-business-date-parity.json
"""

import json
import os
import sys
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, ".github", "scripts"))

from ops_aggregate import get_business_date, get_business_day_bounds  # noqa: E402

OUT = os.path.join(ROOT, "dashboard-app", "src", "__tests__", "fixtures",
                   "w1c-business-date-parity.json")


def parse_boundary(raw):
    parts = raw.split(":")
    return time(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)


def local_to_utc_iso(tz_name, y, mo, d, h, mi, s):
    """Instante UTC de un reloj de pared local (fold=0, igual que zoneinfo)."""
    dt = datetime(y, mo, d, h, mi, s, tzinfo=ZoneInfo(tz_name))
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def main():
    business_date_cases = []
    bounds_cases = []

    # (tz, fecha_base) — Monterrey sin DST, New York con DST, Tokyo UTC+9
    scenarios = [
        ("America/Monterrey", (2026, 8, 7)),
        ("America/New_York", (2026, 8, 7)),
        ("Asia/Tokyo", (2026, 8, 7)),
        # Dias de transicion DST en New York (spring forward / fall back)
        ("America/New_York", (2025, 3, 9)),
        ("America/New_York", (2025, 11, 2)),
    ]
    boundaries = ["04:00:00", "00:00:00", "05:30:00"]

    for tz_name, (y, mo, d) in scenarios:
        tz = ZoneInfo(tz_name)
        for boundary_raw in boundaries:
            boundary = parse_boundary(boundary_raw)
            bh, bm = boundary.hour, boundary.minute
            # Relojes de pared criticos alrededor del boundary y de medianoche
            wall_times = [
                (bh - 1 if bh > 0 else 23, 59, 59),   # boundary - 1s (aprox)
                (bh, bm, 0),                            # boundary exacto
                (bh, bm, 1),                            # boundary + 1s
                (23, 59, 59),
                (0, 0, 1),
                (12, 0, 0),
                (2, 30, 0),                             # madrugada (y hueco DST el 2025-03-09)
            ]
            for (h, mi, s) in wall_times:
                ts_utc = local_to_utc_iso(tz_name, y, mo, d, h, mi, s)
                expected = get_business_date(ts_utc, tz, boundary)
                business_date_cases.append({
                    "ts_utc": ts_utc, "tz": tz_name, "boundary": boundary_raw,
                    "expected": expected,
                    "label": f"{tz_name} {y}-{mo:02d}-{d:02d} {h:02d}:{mi:02d}:{s:02d} local b={boundary_raw}",
                })

            fecha = f"{y}-{mo:02d}-{d:02d}"
            _, _, utc_start, utc_end = get_business_day_bounds(fecha, tz, boundary)
            bounds_cases.append({
                "fecha": fecha, "tz": tz_name, "boundary": boundary_raw,
                "utc_start": utc_start.isoformat().replace("+00:00", "Z"),
                "utc_end": utc_end.isoformat().replace("+00:00", "Z"),
            })
            # Dia siguiente — para verificar continuidad end(D) == start(D+1)
            nd = (datetime(y, mo, d) + timedelta(days=1)).date()
            fecha2 = nd.isoformat()
            _, _, utc_start2, utc_end2 = get_business_day_bounds(fecha2, tz, boundary)
            bounds_cases.append({
                "fecha": fecha2, "tz": tz_name, "boundary": boundary_raw,
                "utc_start": utc_start2.isoformat().replace("+00:00", "Z"),
                "utc_end": utc_end2.isoformat().replace("+00:00", "Z"),
            })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({
            "generated_by": "scripts/wave1/w1c_parity_gen.py (Python = referencia)",
            "business_date_cases": business_date_cases,
            "bounds_cases": bounds_cases,
        }, f, indent=2)
    print(f"OK: {len(business_date_cases)} business_date cases, "
          f"{len(bounds_cases)} bounds cases -> {OUT}")


if __name__ == "__main__":
    main()
