"""Telegram reporter — send exploration summary to Daniel + Mónica."""

import os

import requests


def send_summary(portal_map: dict, xlsx_schemas: dict, duration_sec: float):
    """Send exploration summary to Telegram."""
    print(f"\n[telegram] === Paso 7: Sending Telegram summary ===")

    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_ids = [
        os.getenv("TELEGRAM_CHAT_ID_DANIEL"),
        os.getenv("TELEGRAM_CHAT_ID_MONICA"),
    ]
    chat_ids = [c for c in chat_ids if c]

    if not token or not chat_ids:
        print("[telegram] WARNING: TELEGRAM_BOT_TOKEN or chat IDs not set — skipping")
        return False

    items = portal_map.get("items", [])
    total = len(items)

    # Count by type
    type_counts = {}
    for item in items:
        t = item.get("item_type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1

    # Export stats
    export_items = [i for i in items if i.get("has_export")]
    xlsx_count = len(xlsx_schemas)

    # Endpoint stats
    all_endpoints = set()
    for item in items:
        for ep in item.get("endpoints", []):
            all_endpoints.add(f"{ep['method']} {ep['url']}")
    unique_endpoints = len(all_endpoints)

    # Top reports by column count
    top_reports = []
    for path, schema in xlsx_schemas.items():
        cols = sum(len(s.get("columns", [])) for s in schema.get("sheets", []))
        top_reports.append((path, cols))
    top_reports.sort(key=lambda x: -x[1])

    # Format duration
    mins = int(duration_sec // 60)
    secs = int(duration_sec % 60)

    from datetime import datetime
    now = datetime.now().strftime("%d %b %Y %H:%M")

    msg = f"""🔍 WANSOFT EXPLORER - run completado

⏱ Duración: {mins}m {secs}s
📅 Fecha: {now}

🗂 ITEMS DESCUBIERTOS
• Total: {total}"""

    for t, c in sorted(type_counts.items()):
        msg += f"\n• {t.capitalize()}: {c}"

    msg += f"""

📥 EXPORTS CAPTURADOS
• XLSX descargados: {xlsx_count}
• Items con export: {len(export_items)}

🌐 ENDPOINTS HTTP
• Únicos: {unique_endpoints}"""

    if top_reports:
        msg += "\n\n📊 TOP 5 REPORTS POR DATA RICA"
        for i, (path, cols) in enumerate(top_reports[:5]):
            msg += f"\n{i + 1}. {path} — {cols} cols"

    msg += """

✅ Catálogo en Supabase tabla wansoft_catalog
📁 Artifacts en output/

Listo para Fase 2 (especialización de agentes)."""

    # Send to each chat
    api_url = f"https://api.telegram.org/bot{token}/sendMessage"
    sent = 0
    for chat_id in chat_ids:
        try:
            # Split if too long
            if len(msg) > 4000:
                chunks = [msg[i:i+4000] for i in range(0, len(msg), 4000)]
            else:
                chunks = [msg]

            for chunk in chunks:
                resp = requests.post(api_url, json={
                    "chat_id": chat_id,
                    "text": chunk,
                })
                if resp.status_code == 200:
                    sent += 1
                else:
                    print(f"[telegram]   ERROR sending to {chat_id}: {resp.status_code} {resp.text}")
        except Exception as e:
            print(f"[telegram]   ERROR: {e}")

    print(f"[telegram] Sent to {sent} chats")
    return sent > 0
