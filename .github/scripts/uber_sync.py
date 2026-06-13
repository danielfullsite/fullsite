#!/usr/bin/env python3
"""
Uber Eats Sales Sync — uses saved session cookies to fetch weekly sales
via the merchants.ubereats.com internal API.

Usage:
  python uber_sync.py              # last 8 weeks
  python uber_sync.py --weeks 12   # last 12 weeks

Cookies: ~/.uber-cookies/session.json (from DevTools → Network → Copy as cURL)
Env: SUPABASE_URL / SUPABASE_SERVICE_KEY
"""

import json
import os
import sys
import requests
from datetime import datetime, timedelta, date

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
CLIENT_ID = os.environ.get("CLIENT_ID", "amalay")
WEEKS = int(sys.argv[sys.argv.index("--weeks") + 1]) if "--weeks" in sys.argv else 8
COOKIE_FILE = os.path.expanduser("~/.uber-cookies/session.json")


def load_cookies():
    with open(COOKIE_FILE) as f:
        return json.load(f)


def sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def fetch_week_sales(cookies, start_date, end_date):
    """Fetch sales metrics for a date range."""
    s = int(datetime.strptime(start_date, "%Y-%m-%d").replace(hour=6).timestamp())
    e = int(datetime.strptime(end_date, "%Y-%m-%d").replace(hour=6).timestamp())

    cookie_str = f"sid={cookies['sid']}; jwt-session={cookies['jwt_session']}; selectedRestaurant={cookies['restaurant_uuid']}"
    r = requests.post(
        "https://merchants.ubereats.com/manager/api/getTodaySalesMetrics?localeCode=en",
        headers={
            "content-type": "application/json",
            "cookie": cookie_str,
            "x-csrf-token": "x",
        },
        json={
            "userTimezoneOffset": 360,
            "restaurantUuids": [cookies["restaurant_uuid"]],
            "timeRange": {"startTime": s, "endTime": e},
            "currentDate": f"{start_date} 00:00:00",
            "endDate": f"{end_date} 00:00:00",
            "dominantCurrencyCode": "MXN",
            "isUMetricQueries": True,
        },
        timeout=15,
    )
    if r.ok:
        data = r.json()
        if data.get("status") == "success":
            return data["data"]
    return None


def main():
    if not os.path.exists(COOKIE_FILE):
        print(f"ERROR: No cookies file at {COOKIE_FILE}")
        print("Login to merchants.ubereats.com, copy a request as cURL, and save cookies.")
        sys.exit(1)

    cookies = load_cookies()
    print(f"[uber] Syncing last {WEEKS} weeks")
    print(f"[uber] Restaurant: {cookies['restaurant_uuid']}")

    # Generate week ranges (Mon-Sun)
    today = date.today()
    weeks = []
    for i in range(WEEKS):
        end = today - timedelta(days=today.weekday() + 7 * i)  # last Monday
        end = end + timedelta(days=6)  # Sunday
        start = end - timedelta(days=6)  # Monday
        if end > today:
            end = today
        weeks.append((start.isoformat(), end.isoformat()))

    weeks.reverse()  # oldest first

    print(f"\n{'='*55}")
    print(f"  UBER EATS — AMALAY ({weeks[0][0]} → {weeks[-1][1]})")
    print(f"{'='*55}\n")

    results = []
    total_sales = 0
    total_orders = 0

    for start, end in weeks:
        data = fetch_week_sales(cookies, start, end)
        if data:
            sales = data.get("totalSales", 0)
            orders = data.get("totalOrders", 0)
            avg = data.get("avgTicketSize", 0)
            total_sales += sales
            total_orders += orders
            results.append({
                "start": start, "end": end,
                "sales": sales, "orders": orders, "avg": round(avg, 2),
            })
            print(f"  {start} → {end} | {orders:>3} pedidos | ${sales:>10,} | avg ${avg:>8,.2f}")
        else:
            print(f"  {start} → {end} | FAILED (cookies expired?)")

    print(f"\n  {'TOTAL':>37} {total_orders:>3} pedidos | ${total_sales:>10,}")

    # Upsert to Supabase
    if SUPABASE_URL and SUPABASE_KEY and results:
        print(f"\n[uber] Upserting {len(results)} weeks to Supabase...")
        rows = []
        for r in results:
            rows.append({
                "id": f"uber-week-{r['start']}",
                "client_id": CLIENT_ID,
                "platform": "ubereats",
                "lot_id": f"week-{r['start']}",
                "period_start": r["start"],
                "period_end": r["end"],
                "paid_date": None,
                "total": r["sales"],
                "status": "sales",
                "payment_ref": "",
                "raw_json": json.dumps({
                    "ventas": r["sales"],
                    "pedidos": r["orders"],
                    "ticket_promedio": r["avg"],
                    "source": "api_weekly_sales",
                }),
                "updated_at": datetime.utcnow().isoformat() + "Z",
            })

        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/delivery_platform_payments",
            headers=sb_headers(),
            json=rows,
        )
        if resp.status_code in (200, 201):
            print(f"  {len(rows)} weeks upserted OK")
        else:
            print(f"  Error: {resp.status_code} {resp.text[:300]}")

    print("\n[uber] Done.")


if __name__ == "__main__":
    main()
