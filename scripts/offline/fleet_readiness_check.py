#!/usr/bin/env python3
"""
Offline fleet readiness check — read-only local terminal probe.

Runs against the local Fullsite bridge/server `/health` endpoint and classifies
whether the terminal is ready for a field/offline batch.

No DB writes. No production access. No secrets.

Usage:
  python3 scripts/offline/fleet_readiness_check.py
  python3 scripts/offline/fleet_readiness_check.py --url http://192.168.1.71:7717/health
  python3 scripts/offline/fleet_readiness_check.py --json
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict


DEFAULT_URL = "http://127.0.0.1:7717/health"


@dataclass
class Probe:
    id: str
    status: str  # PASS | WARN | FAIL
    detail: str


def fetch_json(url: str) -> tuple[int, object]:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            raw = resp.read().decode(errors="replace")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return e.code, raw
    except Exception as e:
        return 0, {"error": str(e)}


def add(probes: list[Probe], id_: str, status: str, detail: str) -> None:
    probes.append(Probe(id_, status, detail))
    print(f"[{status}] {id_} — {detail}")


def classify(data: object, http_status: int) -> list[Probe]:
    probes: list[Probe] = []
    if http_status != 200 or not isinstance(data, dict):
        add(probes, "bridge-health", "FAIL", f"/health unreachable or invalid, http_status={http_status}")
        return probes

    add(probes, "bridge-health", "PASS" if data.get("ok") is True else "FAIL", f"ok={data.get('ok')}")

    restaurant_id = data.get("restaurant_id")
    add(probes, "restaurant-id", "PASS" if restaurant_id else "FAIL", f"restaurant_id={restaurant_id or 'MISSING'}")

    version = data.get("version")
    add(probes, "version", "PASS" if version else "WARN", f"version={version or 'MISSING'}")

    clients_connected = data.get("clients_connected")
    if isinstance(clients_connected, int):
        add(probes, "clients-connected", "PASS" if clients_connected >= 0 else "FAIL", f"clients_connected={clients_connected}")
    else:
        add(probes, "clients-connected", "WARN", "clients_connected missing")

    sync_queue_size = data.get("sync_queue_size")
    if isinstance(sync_queue_size, int):
        status = "PASS" if sync_queue_size == 0 else ("WARN" if sync_queue_size <= 100 else "FAIL")
        add(probes, "sync-queue-size", status, f"sync_queue_size={sync_queue_size}")
    else:
        add(probes, "sync-queue-size", "WARN", "sync_queue_size missing")

    failed_prints = data.get("print_jobs_failed")
    if isinstance(failed_prints, int):
        add(probes, "print-jobs-failed", "PASS" if failed_prints == 0 else "WARN", f"print_jobs_failed={failed_prints}")
    else:
        add(probes, "print-jobs-failed", "WARN", "print_jobs_failed missing")

    stations = data.get("stations")
    if isinstance(stations, list):
        needed = {"cocina", "caja"}
        present = {str(s) for s in stations}
        missing = sorted(needed - present)
        add(probes, "stations", "PASS" if not missing else "WARN", f"stations={','.join(sorted(present)) or 'NONE'} missing={','.join(missing) or 'none'}")
    else:
        add(probes, "stations", "WARN", "stations missing")

    lan_ip = data.get("lan_ip")
    add(probes, "lan-ip", "PASS" if lan_ip else "WARN", f"lan_ip={lan_ip or 'MISSING'}")

    return probes


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default=DEFAULT_URL)
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    http_status, data = fetch_json(args.url)
    probes = classify(data, http_status)
    fail = sum(1 for x in probes if x.status == "FAIL")
    warn = sum(1 for x in probes if x.status == "WARN")
    status = "FAIL" if fail else ("WARN" if warn else "PASS")
    payload = {
        "status": status,
        "url": args.url,
        "http_status": http_status,
        "fail": fail,
        "warn": warn,
        "probes": [asdict(x) for x in probes],
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(json.dumps({"status": status, "fail": fail, "warn": warn}, ensure_ascii=False))
    return 0 if status in ("PASS", "WARN") else 1


if __name__ == "__main__":
    raise SystemExit(main())
