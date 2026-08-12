#!/usr/bin/env python3
"""
Demo 24/7 — Generador en vivo. Cada corrida (cron ~5 min): cierra órdenes que ya
"comieron" y abre nuevas en mesas libres → el POS/mesas se ve como un restaurante
vivo, y el día de hoy acumula en pos_orders. Escribe con service_role (bypassa RLS).

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, DEMO_CLIENT (default 'demo-live').
"""
import os, sys, json, random, uuid, datetime as dt
import requests

SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_SERVICE_KEY"]
CLIENT = os.environ.get("DEMO_CLIENT", "demo-live")
H = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}
NOW = dt.datetime.now(dt.timezone.utc)
PAGOS = ["Tarjeta de crédito", "Tarjeta de débito", "Efectivo", "Transferencia electrónica"]

def sb_get(path):
    r = requests.get(f"{SB_URL}/rest/v1/{path}", headers=H, timeout=30)
    return r.json() if r.ok else []

def sb_post(path, data, prefer="return=minimal"):
    return requests.post(f"{SB_URL}/rest/v1/{path}", headers={**H, "Prefer": prefer}, json=data, timeout=30)

def sb_patch(path, data):
    return requests.patch(f"{SB_URL}/rest/v1/{path}", headers={**H, "Prefer": "return=minimal"}, json=data, timeout=30)

def main():
    menu = sb_get(f"pos_menu_items?client_id=eq.{CLIENT}&active=eq.true&select=id,name,price&limit=80")
    staff = sb_get(f"pos_staff?client_id=eq.{CLIENT}&active=eq.true&select=name&limit=12")
    mesas = sb_get(f"pos_mesas?client_id=eq.{CLIENT}&active=eq.true&select=number,capacity&limit=60")
    if not menu or not mesas:
        print(f"[gen] {CLIENT} sin menú/mesas — corre primero el onboarding/seed. Nada que hacer.")
        return
    meseros = [s["name"] for s in staff] or ["Ana López", "Carlos Ruiz", "Diana Torres", "Luis Mena"]
    turno = f"{CLIENT}-{NOW.date().isoformat()}"

    # 1) Cerrar órdenes abiertas con > ~40 min (rotación de mesa).
    open_orders = sb_get(f"pos_orders?client_id=eq.{CLIENT}&status=eq.abierta&select=id,total,created_at,order_revision&limit=100")
    closed = 0
    for o in open_orders:
        try:
            created = dt.datetime.fromisoformat(o["created_at"].replace("Z", "+00:00"))
        except Exception:
            created = NOW
        mins = (NOW - created).total_seconds() / 60
        if mins >= random.randint(35, 70):
            total = float(o.get("total") or 0)
            propina = round(total * random.uniform(0.08, 0.13), 2)
            metodo = random.choices(PAGOS, weights=[46, 24, 22, 8])[0]
            r = sb_patch(f"pos_orders?id=eq.{o['id']}", {
                "status": "pagada", "closed_at": NOW.isoformat(), "metodo_pago": metodo,
                "propina": propina, "pagos": json.dumps([{"metodo": metodo, "monto": round(total + propina, 2)}]),
                "order_revision": int(o.get("order_revision") or 1) + 1, "updated_at": NOW.isoformat(),
            })
            if r.ok:
                closed += 1

    # 2) Abrir nuevas en mesas libres (objetivo ~50% de aforo).
    busy = {str(o["mesa"]) for o in sb_get(f"pos_orders?client_id=eq.{CLIENT}&status=eq.abierta&select=mesa")}
    free = [m for m in mesas if str(m["number"]) not in busy]
    random.shuffle(free)
    target = max(0, int(len(mesas) * random.uniform(0.4, 0.6)) - (len(mesas) - len(free)))
    to_open = min(len(free), max(1, target), random.randint(1, 4))
    opened = 0
    for m in free[:to_open]:
        n_items = random.randint(1, 4)
        chosen = random.sample(menu, min(n_items, len(menu)))
        items, subtotal = [], 0.0
        for it in chosen:
            qty = random.randint(1, 2)
            price = float(it.get("price") or random.randint(60, 220))
            subtotal += price * qty
            items.append({"id": it.get("id"), "nombre": it["name"], "cantidad": qty, "precio": price})
        iva = round(subtotal * 0.16, 2)
        total = round(subtotal + iva, 2)
        r = sb_post("pos_orders", [{
            "id": f"{CLIENT}-{uuid.uuid4().hex[:12]}", "client_id": CLIENT, "mesa": int(m["number"]),
            "mesero": random.choice(meseros), "personas": random.randint(1, int(m.get("capacity") or 4)),
            "status": "abierta", "subtotal": round(subtotal, 2), "iva": iva, "total": total,
            "items": json.dumps(items), "turno_id": turno, "order_revision": 1, "created_at": NOW.isoformat(),
        }])
        if r.ok:
            opened += 1
        else:
            print(f"[gen] insert error {r.status_code}: {r.text[:200]}")

    print(f"[gen] {CLIENT}: cerradas {closed}, abiertas {opened} (mesas {len(mesas)}, libres {len(free)})")

if __name__ == "__main__":
    main()
