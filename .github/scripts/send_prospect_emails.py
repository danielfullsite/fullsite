#!/usr/bin/env python3
"""
Send Prospect Emails — Bulk outreach via Resend API
Flow: CSV/hardcoded list → Resend API → log to Supabase (if table exists) → stdout
Rate limited: max 2 emails/second
"""

import os
import sys
import csv
import json
import time
import requests
from datetime import datetime, timezone

# ── Config ──────────────────────────────────────────────────────────────────
RESEND_API_KEY      = os.environ["RESEND_API_KEY"]
SUPABASE_URL        = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY        = os.environ.get("SUPABASE_SERVICE_KEY", "")
CSV_PATH            = os.environ.get("CSV_PATH", "")
DRY_RUN             = os.environ.get("DRY_RUN", "false").lower() == "true"
RATE_LIMIT          = 2  # max emails per second

RESEND_ENDPOINT     = "https://api.resend.com/emails"
FROM_EMAIL          = "Daniel Ramonfaur <daniel@fullsite.mx>"
WHATSAPP_LINK       = "https://wa.me/528115324371?text=Hola%20Daniel%2C%20me%20interesa%20Fullsite"
DEMO_LINK           = "https://app.fullsite.mx/demo-live"

sb_headers = {}
if SUPABASE_URL and SUPABASE_KEY:
    sb_headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

# ── Hardcoded prospects (fallback if no CSV) ────────────────────────────────
DEFAULT_PROSPECTS = [
    {"name": "Equipo Monopoly", "restaurant": "Monopoly Steakhouse", "email": "hola@monopolysteakhouse.com"},
    {"name": "Equipo UNO", "restaurant": "UNO by Real Madrid", "email": "informacion@unobyrealmadrid.com"},
    {"name": "Equipo Kalma", "restaurant": "Kalma Kava", "email": "kalma.atencion@gmail.com"},
]


# ── HTML Template ───────────────────────────────────────────────────────────
def build_email_html(name: str, restaurant: str) -> str:
    first_name = name.split()[0] if name else "Hola"
    return f"""\
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fullsite para {restaurant}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:24px 16px;">

<!-- Container -->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<!-- Header -->
<tr>
<td style="background-color:#0f172a;padding:32px 40px;text-align:center;">
  <h1 style="margin:0;font-size:28px;font-weight:800;letter-spacing:-0.5px;">
    <span style="color:#ffffff;">full</span><span style="color:#10b981;">site</span>
  </h1>
  <p style="margin:8px 0 0;color:#94a3b8;font-size:13px;letter-spacing:1px;text-transform:uppercase;">
    POS + IA desde el dia uno
  </p>
</td>
</tr>

<!-- Body -->
<tr>
<td style="background-color:#ffffff;padding:40px;">

  <p style="margin:0 0 20px;font-size:16px;color:#1e293b;line-height:1.6;">
    {first_name}, felicidades por la apertura de <strong>{restaurant}</strong> &mdash;
  </p>

  <p style="margin:0 0 24px;font-size:16px;color:#475569;line-height:1.6;">
    Soy Daniel Ramonfaur, 3ra generacion restaurantera en Monterrey y fundador de <strong>Fullsite</strong>.
    Vi que acaban de abrir y quise escribirles porque los primeros meses son clave:
    es cuando mas necesitas <strong>datos en tiempo real</strong> para tomar decisiones rapidas.
  </p>

  <p style="margin:0 0 24px;font-size:16px;color:#475569;line-height:1.6;">
    Fullsite es un punto de venta con <strong>30 agentes de IA</strong> integrados que desde el dia uno te dicen
    que esta funcionando y que no. Sin instalaciones complicadas &mdash; solo abres el navegador en tu computadora
    y listo.
  </p>

  <!-- Feature list -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr>
      <td style="padding:12px 16px;background-color:#f0fdf4;border-left:3px solid #10b981;border-radius:6px;margin-bottom:8px;">
        <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">
          <strong style="color:#059669;">Listo en minutos, no en semanas</strong> &mdash;
          No necesitas instalar nada. Corre en el navegador, usa tu misma red e impresora. Hoy lo configuras, hoy empiezas a vender.
        </p>
      </td>
    </tr>
    <tr><td style="height:8px;"></td></tr>
    <tr>
      <td style="padding:12px 16px;background-color:#f0fdf4;border-left:3px solid #10b981;border-radius:6px;">
        <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">
          <strong style="color:#059669;">Preguntale a tu restaurante</strong> &mdash;
          &ldquo;Como vamos hoy?&rdquo; y en 2 segundos te responde: ventas, ticket promedio, que platillo se esta vendiendo mas. Con voz.
        </p>
      </td>
    </tr>
    <tr><td style="height:8px;"></td></tr>
    <tr>
      <td style="padding:12px 16px;background-color:#f0fdf4;border-left:3px solid #10b981;border-radius:6px;">
        <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">
          <strong style="color:#059669;">Costeo real desde el dia uno</strong> &mdash;
          Sube tus recetas y el sistema te dice el food cost real por platillo. Si un proveedor sube precio, te alerta.
        </p>
      </td>
    </tr>
    <tr><td style="height:8px;"></td></tr>
    <tr>
      <td style="padding:12px 16px;background-color:#f0fdf4;border-left:3px solid #10b981;border-radius:6px;">
        <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">
          <strong style="color:#059669;">Control total sin estar presente</strong> &mdash;
          Briefing diario a las 7am en tu celular. Alertas de anti-fraude, prediccion de cierre, y coaching para tu equipo. Todo automatico.
        </p>
      </td>
    </tr>
    <tr><td style="height:8px;"></td></tr>
    <tr>
      <td style="padding:12px 16px;background-color:#f0fdf4;border-left:3px solid #10b981;border-radius:6px;">
        <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">
          <strong style="color:#059669;">Todo incluido</strong> &mdash;
          POS, comandero, pantalla de cocina (KDS), inventario, facturacion CFDI, y 30 agentes de IA. Sin modulos extra ni costos ocultos.
        </p>
      </td>
    </tr>
  </table>

  <!-- Social proof -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
    <tr>
      <td style="background-color:#0f172a;padding:20px 24px;border-radius:8px;text-align:center;">
        <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">
          Ya operando en Monterrey
        </p>
        <p style="margin:0;font-size:22px;font-weight:700;color:#10b981;">
          +880 dias de datos reales analizados
        </p>
        <p style="margin:6px 0 0;font-size:14px;color:#cbd5e1;">
          Hecho por restauranteros, para restauranteros
        </p>
      </td>
    </tr>
  </table>

  <!-- Price -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr>
      <td style="padding:10px;text-align:center;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Desde</p>
        <p style="margin:4px 0;font-size:28px;font-weight:800;color:#1e293b;">$4,999/mes</p>
        <p style="margin:0;font-size:13px;color:#64748b;">POS completo + 30 agentes IA + soporte dedicado</p>
      </td>
    </tr>
  </table>

  <!-- CTA buttons -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding-bottom:12px;">
        <a href="{DEMO_LINK}" target="_blank"
           style="display:inline-block;background-color:#10b981;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;">
          Ver demo en vivo
        </a>
      </td>
    </tr>
    <tr>
      <td align="center">
        <a href="{WHATSAPP_LINK}" target="_blank"
           style="display:inline-block;background-color:#0f172a;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;">
          Escribeme por WhatsApp
        </a>
      </td>
    </tr>
  </table>

</td>
</tr>

<!-- Footer -->
<tr>
<td style="background-color:#0f172a;padding:24px 40px;text-align:center;">
  <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">
    Daniel Ramonfaur &middot; Fundador de Fullsite
  </p>
  <p style="margin:0;font-size:12px;color:#64748b;">
    Monterrey, MX &middot; +52 811 532 4371 &middot; daniel@fullsite.mx
  </p>
</td>
</tr>

</table>
<!-- /Container -->

</td></tr>
</table>
</body>
</html>"""


def build_subject(restaurant: str) -> str:
    return f"{restaurant} + IA desde el dia uno"


# ── Load prospects ──────────────────────────────────────────────────────────
def load_prospects() -> list[dict]:
    """Load from CSV if path given, otherwise use hardcoded list."""
    if CSV_PATH and os.path.exists(CSV_PATH):
        prospects = []
        with open(CSV_PATH, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Expect columns: name, restaurant, email
                prospects.append({
                    "name": row.get("name", row.get("nombre", "")).strip(),
                    "restaurant": row.get("restaurant", row.get("restaurante", "")).strip(),
                    "email": row.get("email", row.get("correo", "")).strip(),
                })
        print(f"[CSV] Loaded {len(prospects)} prospects from {CSV_PATH}")
        return prospects

    if DEFAULT_PROSPECTS:
        print(f"[HARDCODED] Using {len(DEFAULT_PROSPECTS)} hardcoded prospects")
        return DEFAULT_PROSPECTS

    print("[ERROR] No CSV_PATH set and DEFAULT_PROSPECTS is empty. Nothing to send.")
    sys.exit(1)


# ── Send email via Resend ───────────────────────────────────────────────────
def send_email(prospect: dict) -> dict:
    """Send one email. Returns {success, resend_id, error}."""
    payload = {
        "from": FROM_EMAIL,
        "to": [prospect["email"]],
        "subject": build_subject(prospect["restaurant"]),
        "html": build_email_html(prospect["name"], prospect["restaurant"]),
    }

    if DRY_RUN:
        print(f"  [DRY RUN] Would send to {prospect['email']}")
        return {"success": True, "resend_id": "dry-run", "error": None}

    try:
        resp = requests.post(
            RESEND_ENDPOINT,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=15,
        )
        data = resp.json()
        if resp.status_code in (200, 201):
            return {"success": True, "resend_id": data.get("id", ""), "error": None}
        else:
            return {"success": False, "resend_id": None, "error": data.get("message", str(data))}
    except Exception as e:
        return {"success": False, "resend_id": None, "error": str(e)}


# ── Log to Supabase ────────────────────────────────────────────────────────
def log_to_supabase(results: list[dict]):
    """Best-effort log to prospects table. Silently skips if table doesn't exist."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[LOG] No Supabase credentials — skipping DB log")
        return

    for r in results:
        row = {
            "email": r["email"],
            "name": r["name"],
            "restaurant": r["restaurant"],
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "resend_id": r.get("resend_id"),
            "success": r.get("success", False),
            "error": r.get("error"),
        }
        try:
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/prospects",
                headers=sb_headers,
                json=row,
                timeout=10,
            )
            if resp.status_code in (200, 201):
                pass  # logged OK
            elif resp.status_code == 404:
                print("[LOG] prospects table not found — skipping DB log")
                return
            else:
                print(f"[LOG] Supabase error {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            print(f"[LOG] Supabase request failed: {e}")
            return


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    prospects = load_prospects()
    if not prospects:
        print("[DONE] No prospects to send to.")
        return

    print(f"\n{'='*60}")
    print(f"  Fullsite Prospect Emails")
    print(f"  Prospects: {len(prospects)}")
    print(f"  Dry run:   {DRY_RUN}")
    print(f"  Rate:      {RATE_LIMIT}/sec")
    print(f"{'='*60}\n")

    results = []
    sent = 0
    failed = 0
    interval = 1.0 / RATE_LIMIT  # 0.5s between emails

    for i, prospect in enumerate(prospects):
        email = prospect.get("email", "")
        name = prospect.get("name", "?")
        restaurant = prospect.get("restaurant", "?")

        if not email or "@" not in email:
            print(f"  [{i+1}/{len(prospects)}] SKIP — invalid email: {email}")
            results.append({**prospect, "success": False, "error": "invalid email"})
            failed += 1
            continue

        print(f"  [{i+1}/{len(prospects)}] Sending to {name} <{email}> ({restaurant})...", end=" ")

        result = send_email(prospect)
        result.update(prospect)
        results.append(result)

        if result["success"]:
            sent += 1
            print(f"OK (id: {result.get('resend_id', '?')})")
        else:
            failed += 1
            print(f"FAIL ({result.get('error', '?')})")

        # Rate limit — sleep between sends (skip after last one)
        if i < len(prospects) - 1:
            time.sleep(interval)

    # Summary
    print(f"\n{'='*60}")
    print(f"  RESULTS: {sent} sent, {failed} failed, {len(prospects)} total")
    print(f"{'='*60}\n")

    # Log to Supabase
    log_to_supabase(results)

    # Exit with error if any failed
    if failed > 0 and sent == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
