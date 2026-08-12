#!/usr/bin/env python3
"""
Demo 24/7 — Seed de 1 año de historial (wansoft_daily) para un tenant demo-live.
Genera ventas diarias realistas (patrón semana/fin de semana + tendencia + ruido),
con meseros/platillos/grupos/pagos consistentes, usando el menú y staff REALES del
tenant. Idempotente: borra el histórico del tenant y lo re-siembra.

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, DEMO_CLIENT (default 'demo-live'), DEMO_DAYS (default 365).
"""
import os, sys, json, random, datetime as dt
import requests

SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_SERVICE_KEY"]
CLIENT = os.environ.get("DEMO_CLIENT", "demo-live")
DAYS = int(os.environ.get("DEMO_DAYS", "365"))
H = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}

def sb_get(path):
    r = requests.get(f"{SB_URL}/rest/v1/{path}", headers=H, timeout=30)
    return r.json() if r.ok else []

def main():
    random.seed(f"{CLIENT}-demo-history")
    # Menú y staff reales del tenant (para nombres). Fallback genérico.
    items = sb_get(f"pos_menu_items?client_id=eq.{CLIENT}&active=eq.true&select=name,price&limit=60") or []
    staff = sb_get(f"pos_staff?client_id=eq.{CLIENT}&active=eq.true&role=in.(mesero,capitan,gerente)&select=name&limit=12") or []
    item_names = [(i["name"], float(i.get("price") or random.randint(60, 260))) for i in items] or \
        [(n, p) for n, p in [("Café Latte", 65), ("Chilaquiles", 165), ("Avocado Toast", 145), ("Omelette", 155),
                             ("Pancakes", 135), ("Ensalada César", 175), ("Burger", 195), ("Smoothie Verde", 95),
                             ("Cappuccino", 60), ("Pan Dulce", 45), ("Jugo Natural", 70), ("Bowl Keto", 185)]]
    mesero_names = [s["name"] for s in staff] or ["Ana López", "Carlos Ruiz", "Diana Torres", "Luis Mena", "Sofía Cruz", "Marco Díaz"]
    grupos = ["Desayunos", "Café", "Bebidas", "Comida", "Postres", "Bowls & Ensaladas", "Panadería", "Jugos"]
    pagos_base = [("Tarjeta de crédito", 0.46), ("Tarjeta de débito", 0.24), ("Efectivo", 0.22), ("Transferencia electrónica", 0.08)]

    rows = []
    today = dt.date.today()
    for d in range(DAYS, 0, -1):
        fecha = today - dt.timedelta(days=d)
        wd = fecha.weekday()  # 0=lun
        base = 42000
        base *= 1.55 if wd >= 5 else (1.0 if wd < 4 else 1.2)   # fin de semana fuerte
        base *= 1 + (DAYS - d) * 0.0006                          # tendencia leve al alza
        base *= random.uniform(0.82, 1.18)                       # ruido
        ventas = round(base, 1)
        tickets = max(8, int(ventas / random.uniform(360, 620)))
        personas = int(tickets * random.uniform(1.6, 2.4))
        tp = round(ventas / tickets, 1)
        efectivo = round(ventas * random.uniform(0.18, 0.26), 1)
        tarjeta = round(ventas - efectivo, 1)
        propinas = round(ventas * random.uniform(0.06, 0.11), 1)

        random.shuffle(mesero_names)
        n_mes = min(len(mesero_names), random.randint(4, 6))
        mesero_slice = mesero_names[:n_mes]
        weights = sorted([random.uniform(0.6, 1.6) for _ in mesero_slice], reverse=True)
        wsum = sum(weights)
        meseros = [{"nombre": m, "total": round(ventas * w / wsum, 1)} for m, w in zip(mesero_slice, weights)]

        top = sorted(random.sample(item_names, min(len(item_names), 14)), key=lambda x: -x[1])
        platillos = []
        rem = ventas * 0.9
        for name, price in top:
            cant = max(1, int(rem / (price * len(top)) * random.uniform(0.5, 1.8)))
            platillos.append({"nombre": name.upper(), "cantidad": cant, "total": round(cant * price, 1)})
        gtot = ventas
        gw = sorted([random.uniform(0.5, 1.8) for _ in grupos], reverse=True); gws = sum(gw)
        ventas_grupo = [{"nombre": g, "total": round(gtot * w / gws, 1)} for g, w in zip(grupos, gw)]
        pagos = [{"nombre": n, "total": round(ventas * f, 1), "pct": round(f * 100, 1)} for n, f in pagos_base]

        rows.append({
            "client_slug": CLIENT, "fecha": fecha.isoformat(),
            "ventas_brutas": round(ventas * 1.01, 1), "ventas_dia": ventas,
            "descuentos": round(ventas * 0.01, 1), "efectivo": efectivo, "tarjeta": tarjeta,
            "tickets_count": tickets, "personas_restaurant": personas, "ticket_promedio_restaurant": tp,
            "propinas_total": propinas, "meseros": json.dumps(meseros), "platillos_top": json.dumps(platillos),
            "ventas_por_grupo": json.dumps(ventas_grupo), "pago_metodos": json.dumps(pagos),
        })

    # Borra el histórico del tenant y re-siembra (idempotente).
    requests.delete(f"{SB_URL}/rest/v1/wansoft_daily?client_slug=eq.{CLIENT}", headers=H, timeout=30)
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        r = requests.post(f"{SB_URL}/rest/v1/wansoft_daily", headers={**H, "Prefer": "return=minimal"}, json=chunk, timeout=60)
        if not r.ok:
            print(f"[history] insert error {r.status_code}: {r.text[:300]}"); sys.exit(1)
    print(f"[history] {len(rows)} días sembrados para {CLIENT} ({rows[0]['fecha']} → {rows[-1]['fecha']})")

if __name__ == "__main__":
    main()
