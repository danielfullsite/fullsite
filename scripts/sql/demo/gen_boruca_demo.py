#!/usr/bin/env python3
"""
Generador de seed DEMO para un tenant Fullsite (fullsite.mx multi-tenant).
Produce un .sql autocontenido y re-ejecutable (DELETE + INSERT por client_id).
Corre local, SIN tocar la BD. El .sql se pega en el SQL editor de Supabase (prod).
Fechas de órdenes = now() - interval → siempre frescas cuando se corra.

Uso: python3 gen_boruca_demo.py > boruca_demo_seed.sql
"""
import json, random

random.seed(42)  # reproducible

CID = "boruca"
DISPLAY = "Boruca Restaurant & Bar"
CITY = "Monclova, Coah."
PHONE = "8661052888"
ADDRESS = "Centro, Monclova, Coahuila"
LOCATION = "boruca-centro"
FOOTER = "Boruca Restaurant & Bar — Gracias por tu visita"
ACCENT = "green"

def q(s):  # escapa string para SQL
    return "'" + str(s).replace("'", "''") + "'"

def jq(obj):  # jsonb literal escapado
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'::jsonb"

# ── Menú (ficticio, restaurante-bar Monclova) ──────────────────────────────
MENU = {
    "ENTRADAS": [
        ("Guacamole con totopos", 145), ("Queso fundido con chorizo", 135),
        ("Alitas Boruca (10 pz)", 165), ("Nachos supremos", 155),
        ("Aros de cebolla", 95), ("Dedos de queso", 115),
    ],
    "CORTES Y FUERTES": [
        ("Arrachera 300g", 320), ("Ribeye 350g", 425), ("Molcajete Boruca", 295),
        ("Tacos de arrachera (4)", 185), ("Salmón a la parrilla", 265),
        ("Pechuga rellena", 215),
    ],
    "HAMBURGUESAS Y ANTOJOS": [
        ("Hamburguesa Boruca", 175), ("Costillas BBQ", 245),
        ("Quesadillas de rib eye", 165), ("Burrito norteño", 135),
    ],
    "COCTELERÍA": [
        ("Margarita", 135), ("Michelada Boruca", 95), ("Mojito", 125),
        ("Paloma", 110), ("Carajillo", 115), ("Gin tonic", 145),
    ],
    "CERVEZAS": [
        ("Cerveza nacional", 55), ("Cerveza importada", 75), ("Cubetazo (5)", 250),
    ],
    "POSTRES": [
        ("Pastel de chocolate", 95), ("Churros con cajeta", 85), ("Flan napolitano", 80),
    ],
    "BEBIDAS": [
        ("Refresco", 45), ("Agua fresca", 50), ("Café americano", 45), ("Limonada", 50),
    ],
}
CAT_COLOR = {"ENTRADAS":"#22c55e","CORTES Y FUERTES":"#ef4444","HAMBURGUESAS Y ANTOJOS":"#f59e0b",
             "COCTELERÍA":"#8b5cf6","CERVEZAS":"#eab308","POSTRES":"#ec4899","BEBIDAS":"#06b6d4"}

STAFF = [  # (nombre, pin, rol)
    ("Rodrigo Salas", "1122", "mesero"), ("Fernanda Ríos", "2233", "mesero"),
    ("Diego Cantú", "3344", "mesero"), ("Mariana López", "4455", "mesero"),
    ("Carlos Fuentes", "5566", "cajero"), ("Alejandra Ovalle", "6677", "gerente"),
]
MESEROS = [s[0] for s in STAFF if s[2] == "mesero"]
PAYMENTS = [("Efectivo","cash"),("Tarjeta de crédito","card"),("Tarjeta de débito","card"),("Transferencia","transfer")]
N_MESAS = 14

out = []
w = out.append
w("-- ============================================================")
w("-- DEMO SEED — Boruca Restaurant & Bar  (client_id = 'boruca')")
w("-- Fullsite fullsite.mx · datos FICTICIOS · re-ejecutable")
w("-- Pegar completo en el SQL editor de Supabase (corre como service role).")
w("-- ============================================================")
w("BEGIN;")
w("")
w("-- Limpieza (re-ejecutable)")
for t in ["pos_orders","pos_menu_items","pos_menu_categories","pos_staff","pos_mesas","pos_payment_methods"]:
    w(f"DELETE FROM {t} WHERE client_id = {q(CID)};")
w(f"DELETE FROM clients WHERE id = {q(CID)};")
w("")

# ── clients ────────────────────────────────────────────────────────────────
features = {"pos":True,"posRestaurant":True,"posTienda":False,"delivery":False,"ecommerce":False,
            "inventory":True,"foodCost":True,"facturacion":True,"nomina":False,"agentesIA":True,
            "coach":True,"chatIA":True,"resenas":False,"giftCards":False}
w("-- Tenant")
w("INSERT INTO clients (id, display_name, city, timezone, default_theme, accent_color, mesas, "
  "meseros, features, iva_rate, type, data_source, address, phone, receipt_footer, plan, "
  "pos_write_authority, active) VALUES (")
w(f"  {q(CID)}, {q(DISPLAY)}, {q(CITY)}, 'America/Mexico_City', 'light', {q(ACCENT)}, {N_MESAS},")
w(f"  {q(json.dumps(MESEROS, ensure_ascii=False))}, {q(json.dumps(features))}, 0, 'Restaurant & Bar',")
w(f"  'supabase', {q(ADDRESS)}, {q(PHONE)}, {q(FOOTER)}, 'fullsite_software', 'supabase', true);")
w("")

# ── categorías + items ──────────────────────────────────────────────────────
w("-- Menú")
item_pool = []  # (nombre, precio)
for ci, (cat, items) in enumerate(MENU.items()):
    cat_id = f"{CID}-cat-{ci+1}"
    w(f"INSERT INTO pos_menu_categories (id, client_id, name, color, sort_order, active) VALUES "
      f"({q(cat_id)}, {q(CID)}, {q(cat)}, {q(CAT_COLOR[cat])}, {ci+1}, true);")
    for ii, (name, price) in enumerate(items):
        item_id = f"{CID}-it-{ci+1}-{ii+1}"
        w(f"INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES "
          f"({q(item_id)}, {q(CID)}, {q(cat_id)}, {q(name)}, {price}, {ii+1}, true);")
        if cat not in ("BEBIDAS",):  # las bebidas también venden, pero pesan menos en el mix
            item_pool.append((name, price))
        item_pool.append((name, price))  # todo entra al pool de ventas
w("")

# ── staff ────────────────────────────────────────────────────────────────────
w("-- Personal")
for si, (name, pin, role) in enumerate(STAFF):
    sid = f"{CID}-staff-{si+1}"
    w(f"INSERT INTO pos_staff (id, client_id, name, pin, role, active) VALUES "
      f"({q(sid)}, {q(CID)}, {q(name)}, {q(pin)}, {q(role)}, true);")
w("")

# ── mesas (grid simple con coords para el plano) ─────────────────────────────
w("-- Mesas")
for n in range(1, N_MESAS+1):
    col = (n-1) % 5
    row = (n-1) // 5
    x = round(12 + col*19, 2)
    y = round(15 + row*26, 2)
    cap = random.choice([2,4,4,6])
    shape = "round" if cap <= 4 else "rect-h"
    mid = f"{CID}-mesa-{n}"
    w(f"INSERT INTO pos_mesas (id, client_id, number, capacity, zone, x_pct, y_pct, shape, sort_order, active) VALUES "
      f"({q(mid)}, {q(CID)}, {n}, {cap}, 'Salón', {x}, {y}, {q(shape)}, {n}, true);")
w("")

# ── métodos de pago ──────────────────────────────────────────────────────────
w("-- Métodos de pago")
for pi, (pname, ptype) in enumerate(PAYMENTS):
    pid = f"{CID}-pay-{pi+1}"
    w(f"INSERT INTO pos_payment_methods (id, client_id, name, type, commission_pct, active) VALUES "
      f"({q(pid)}, {q(CID)}, {q(pname)}, {q(ptype)}, 0, true);")
w("")

# ── órdenes: ~30 días de ventas ficticias (fechas frescas via now()-interval) ─
w("-- Ventas (últimos 30 días) — fechas relativas a now() para que siempre salgan frescas")
order_no = 0
rows = []
for days_ago in range(0, 30):
    # más ventas fin de semana
    base = 22 if days_ago % 7 in (5, 6) else 14
    n_orders = base + random.randint(-4, 8)
    for _ in range(n_orders):
        order_no += 1
        n_items = random.randint(1, 4)
        chosen = random.sample(item_pool, k=min(n_items, len(item_pool)))
        items_json = []
        subtotal = 0
        for (nm, pr) in chosen:
            cant = random.randint(1, 3)
            st = pr * cant
            subtotal += st
            items_json.append({"nombre": nm, "precio": pr, "cantidad": cant, "subtotal": st})
        propina = round(subtotal * random.choice([0.10, 0.12, 0.15, 0.15, 0.18]))
        mesa = random.randint(1, N_MESAS)
        mesero = random.choice(MESEROS)
        personas = random.randint(1, 6)
        metodo = random.choice([p[0] for p in PAYMENTS])
        hour = random.randint(12, 23)
        minute = random.randint(0, 59)
        created = f"now() - interval '{days_ago} days' - interval '{hour} hours' - interval '{minute} minutes'"
        closed = f"now() - interval '{days_ago} days' - interval '{hour} hours' - interval '{max(minute-45,0)} minutes'"
        rows.append(
            f"({q(CID)}, {mesa}, {q(mesero)}, {personas}, 'cerrada', {subtotal}, 0, {subtotal}, 0, "
            f"{q(metodo)}, {jq(items_json)}, {propina}, {order_no}, {q(LOCATION)}, {created}, {closed})"
        )
# batch en grupos de 100
COLS = ("client_id, mesa, mesero, personas, status, subtotal, iva, total, descuento, "
        "metodo_pago, items, propina, order_number, location_id, created_at, closed_at")
for i in range(0, len(rows), 100):
    chunk = rows[i:i+100]
    w(f"INSERT INTO pos_orders ({COLS}) VALUES")
    w(",\n".join("  " + r for r in chunk) + ";")
w("")
w(f"-- Total órdenes generadas: {len(rows)}")
w("COMMIT;")
w("")
w(f"-- ✅ Demo listo. Ver en fullsite.mx: /platform/tenants → Entrar '{CID}' (act-as).")

print("\n".join(out))
