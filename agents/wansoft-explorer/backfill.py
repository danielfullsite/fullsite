"""Backfill wansoft_daily from Wansoft API — resume-safe."""
import requests, json, time, os, sys
from datetime import date, timedelta
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv(override=True)

WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"
sb_url = os.environ["SUPABASE_URL"].rstrip("/")
sb_key = os.environ["SUPABASE_SERVICE_KEY"]
sb_h = {"apikey": sb_key, "Authorization": f"Bearer {sb_key}",
        "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}

def pr(html):
    return [[c.text.strip() for c in r.select("div")]
            for r in BeautifulSoup(html, "html.parser").select(".rowReport")]

def login():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    r = s.post(f"{WANSOFT_URL}/", data={"UserName": os.environ["WANSOFT_USER"],
               "Password": os.environ["WANSOFT_PASS"]}, allow_redirects=True)
    if "Dashboard" not in r.url:
        raise Exception("Login failed")
    return s

def fetch_day(s, d):
    c = s.post(f"{WANSOFT_URL}/Reports/GetConsolidatedSales",
               data={"subsidiaryId": "6043", "startDate": d, "endDate": d}, timeout=15).json()
    v = c.get("TotalSales", 0)
    if v == 0:
        return None

    rows = pr(s.post(f"{WANSOFT_URL}/Reports/SalesByTypeOfOrder",
              data={"subsidiaryId": "6043", "startDate": d, "endDate": d}, timeout=15).text)
    tix = sum(int(r[2]) for r in rows if len(r) >= 6 and r[2].isdigit())
    per = sum(int(r[3]) for r in rows if len(r) >= 6 and r[3].isdigit())

    mes = [{"nombre": r[0], "total": float(r[3].replace("$", "").replace(",", ""))}
           for r in pr(s.post(f"{WANSOFT_URL}/Reports/SalesByUser",
           data={"subsidiaryId": "6043", "startDate": d, "endDate": d}, timeout=15).text) if len(r) >= 5]

    grp = [{"nombre": r[0], "total": float(r[3].replace("$", "").replace(",", ""))}
           for r in pr(s.post(f"{WANSOFT_URL}/Reports/SalesByGroup",
           data={"subsidiaryId": "6043", "startDate": d, "endDate": d}, timeout=15).text) if len(r) >= 5]

    pay = pr(s.post(f"{WANSOFT_URL}/Reports/SalesByPaymentType",
             data={"subsidiaryId": "6043", "startDate": d, "endDate": d}, timeout=15).text)
    ef = ta = 0
    pm = []
    for r in pay:
        if len(r) >= 5:
            t = float(r[3].replace("$", "").replace(",", ""))
            pm.append({"nombre": r[0], "total": t})
            if "fectivo" in r[0].lower(): ef = t
            elif "arjeta" in r[0].lower(): ta += t

    return {
        "fecha": d, "ventas_dia": v, "ventas_brutas": c.get("TotalGrossSales", 0),
        "descuentos": c.get("TotalDiscount", 0), "tickets_count": tix,
        "personas_restaurant": per, "ticket_promedio_restaurant": v / tix if tix else 0,
        "efectivo": ef, "tarjeta": ta, "meseros": json.dumps(mes),
        "ventas_por_grupo": json.dumps(grp), "pago_metodos": json.dumps(pm),
    }

def main():
    start = date(2024, 6, 1)
    end = date(2025, 12, 31)

    # Check what we already have
    r = requests.get(f"{sb_url}/rest/v1/wansoft_daily",
        headers={"apikey": sb_key, "Authorization": f"Bearer {sb_key}"},
        params={"select": "fecha", "fecha": f"gte.{start.isoformat()}", "limit": "1000"})
    existing = {row["fecha"] for row in r.json()}
    print(f"Already have {len(existing)} days in range", flush=True)

    s = login()
    print("Login OK", flush=True)

    cur = start
    ok = skip = err = 0

    while cur <= end:
        d = cur.isoformat()
        if d in existing:
            skip += 1
            cur += timedelta(days=1)
            continue

        try:
            row = fetch_day(s, d)
            if row is None:
                skip += 1
            else:
                requests.post(f"{sb_url}/rest/v1/wansoft_daily", headers=sb_h, json=row, timeout=10)
                ok += 1
                if ok % 20 == 0:
                    print(f"  {d} — {ok} new days saved", flush=True)
        except Exception as e:
            err += 1
            if "Dashboard" not in str(e) and err <= 5:
                print(f"  Error {d}: {e}", flush=True)
            # Re-login every 10 errors
            if err % 5 == 0:
                try:
                    s = login()
                    print(f"  Re-login at {d}", flush=True)
                except Exception as le:
                    print(f"  Re-login failed: {le}", flush=True)
                    time.sleep(5)

        cur += timedelta(days=1)
        time.sleep(0.15)

    print(f"\nDone: {ok} new, {skip} skipped, {err} errors", flush=True)

if __name__ == "__main__":
    main()
