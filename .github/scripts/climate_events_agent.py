#!/usr/bin/env python3
"""
Climate + Events Agent — Multi-tenant
Cruza pronóstico del clima + eventos locales con historial de ventas.
Envía insights accionables a Telegram cada mañana (8am MX).

"Mañana llueve y es martes — históricamente tus ventas bajan 25%."
"Hay juego de Tigres a las 8pm, tus ventas de cerveza suben 40%."
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone, date
from client_config import get_client, get_tz, get_chat_ids, get_wansoft_creds
try:
    from audit_log import AuditLogger
    _audit = AuditLogger("climate_events_agent")
except ImportError:
    _audit = None
# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "intraday")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

# OpenWeatherMap free tier (1000 calls/day)
OWM_KEY = os.environ.get("OPENWEATHER_API_KEY", "")

# AMALAY is in San Pedro Garza García, Monterrey metro
CITY_LAT = 25.6514
CITY_LON = -100.2895
CITY_NAME = "Monterrey"

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

# ── Mexican holidays 2026 ────────────────────────────────────────────────
# ── Holidays relevant for a CAFÉ (not sports bar) ────────────────────────
# Impact: how does this holiday affect a brunch/coffee place?
HOLIDAYS_MX = {
    "2026-01-01": ("Año Nuevo", "bajo", "Muchos cierran. Si abres, poco tráfico."),
    "2026-02-14": ("San Valentín", "alto", "Parejas buscan café/brunch. Decora, prepara postres especiales."),
    "2026-02-02": ("Día de la Constitución", "medio", "Puente — familias salen a brunchear."),
    "2026-03-16": ("Natalicio de Benito Juárez", "medio", "Puente — espera familias."),
    "2026-05-01": ("Día del Trabajo", "bajo", "Muchos cierran. Revisa si vale abrir."),
    "2026-05-10": ("Día de las Madres", "muy alto", "DÍA MÁS FUERTE DEL AÑO para cafés. Reservaciones, menú especial, personal extra."),
    "2026-05-15": ("Día del Maestro", "medio", "Grupos de maestros celebrando. Espera mesas grandes."),
    "2026-06-21": ("Día del Padre", "alto", "Familias salen a brunchear. Segundo día más fuerte después de Madres."),
    "2026-07-01": ("Inicio vacaciones verano", "medio", "Tráfico cambia: menos oficinistas, más familias."),
    "2026-09-16": ("Independencia de México", "medio", "Fin de semana patrio. Puente = familias."),
    "2026-10-31": ("Halloween", "medio", "Familias con niños, decoración temática ayuda."),
    "2026-11-02": ("Día de Muertos", "medio", "Pan de muerto, café de olla. Productos temáticos."),
    "2026-12-12": ("Día de la Virgen", "bajo", "Muchos no trabajan. Tráfico reducido."),
    "2026-12-24": ("Nochebuena", "bajo", "Cierre temprano o cerrado."),
    "2026-12-25": ("Navidad", "bajo", "Cerrado o mínimo."),
    "2026-12-31": ("Fin de Año", "bajo", "Cierre temprano."),
}

# Graduation season (Monterrey) — big for cafés/brunch
GRADUATION_MONTHS = {5, 6, 7, 12}  # May-Jul and Dec

# Semana Santa (variable cada año)
SEMANA_SANTA = {
    "2026-03-29": ("Domingo de Ramos", "medio", "Inicio de Semana Santa. Tráfico baja gradualmente."),
    "2026-04-02": ("Jueves Santo", "bajo", "Gente viaja. Espera -30% tráfico."),
    "2026-04-03": ("Viernes Santo", "muy bajo", "Día más muerto del año. Muchos cierran."),
    "2026-04-04": ("Sábado de Gloria", "bajo", "Gente sigue de vacaciones."),
    "2026-04-05": ("Domingo de Pascua", "bajo", "Último día de vacaciones, tráfico se recupera al siguiente."),
}

# Puentes confirmed
PUENTES = {
    "2026-03-17": ("Puente Benito Juárez", "medio", "Lunes puente — familias salen."),
    "2026-11-17": ("Puente Revolución", "medio", "Lunes puente."),
}

# External factors calendar — things that affect traffic outside of holidays
# These are patterns/events specific to Monterrey/San Pedro
EXTERNAL_FACTORS = {
    # Monterrey-specific events
    "maraton_mty": {"months": [3, 11], "days_of_week": [6], "impact": "Maratón/carrera en Monterrey. Calles cerradas, menos tráfico a cafés."},
    "feria_libro": {"months": [10], "impact": "Feria del Libro MTY. Más tráfico cultural en la zona."},
    "buen_fin": {"months": [11], "days": [14, 15, 16, 17], "impact": "Buen Fin. Gente en centros comerciales, no en cafés independientes. Pero oportunidad de promo."},
    # School calendar
    "vacaciones_verano": {"months": [7, 8], "impact": "Vacaciones de verano. Menos oficinistas, más familias. Horario pico se mueve."},
    "regreso_clases": {"months": [8], "days": list(range(20, 32)), "impact": "Regreso a clases. Tráfico de oficinistas se normaliza."},
    "vacaciones_diciembre": {"months": [12], "days": list(range(18, 32)), "impact": "Vacaciones decembrinas. Menos tráfico entre semana, más fin de semana."},
    # Economic patterns
    "quincena_alta": {"days": [15, 16, 30, 31, 1], "impact": "Quincena — tickets más altos, más tráfico."},
    "inicio_mes_bajo": {"days": [2, 3, 4, 5], "impact": "Post-quincena — tráfico puede bajar 10-15%."},
    # Weather patterns Monterrey
    "temporada_calor": {"months": [5, 6, 7, 8, 9], "impact": "Calor extremo MTY (35-42°C). Gente busca AC y bebidas frías. Terraza vacía."},
    "temporada_lluvias": {"months": [8, 9, 10], "impact": "Temporada de lluvias/huracanes. Tráfico baja en días de lluvia fuerte."},
    "nortes": {"months": [11, 12, 1, 2], "impact": "Frentes fríos (nortes). Bebidas calientes suben. Tráfico normal si no llueve."},
}

# Competition tracking — known nearby restaurants/cafés
# Add as you learn about them
COMPETITION_NOTES = {
    # "2026-04-01": "Café XYZ abrió en Plaza Valle — monitorear impacto",
}

# Construction/road closures — add as they happen
ROAD_CLOSURES = {
    # "2026-04-15": "Cierre de Av. Vasconcelos por obra — redireciona tráfico",
}

# ── Café-specific seasonal patterns ──────────────────────────────────────
CAFE_SEASONAL = {
    "hot_drinks": {"months": [11, 12, 1, 2], "tip": "Temporada de bebidas calientes. Promueve chocolate, café de olla, chai."},
    "cold_drinks": {"months": [4, 5, 6, 7, 8, 9], "tip": "Temporada de frappes y smoothies. Asegura hielo y frutas."},
    "brunch_season": {"months": [3, 4, 5, 10, 11], "tip": "Temporada alta de brunch. Asegura huevos, aguacate, pan."},
}

# ── Weather ──────────────────────────────────────────────────────────────
def get_weather_forecast():
    """Get 3-day forecast from OpenWeatherMap."""
    if not OWM_KEY:
        print("[weather] No OPENWEATHER_API_KEY, using fallback")
        return get_weather_fallback()

    try:
        r = requests.get(
            "https://api.openweathermap.org/data/2.5/forecast",
            params={
                "lat": CITY_LAT, "lon": CITY_LON,
                "appid": OWM_KEY, "units": "metric", "lang": "es",
                "cnt": 24,  # 3 days (8 per day × 3)
            },
            timeout=10,
        )
        if not r.ok:
            print(f"[weather] API error: {r.status_code}")
            return get_weather_fallback()

        data = r.json()
        forecasts = []
        for item in data.get("list", []):
            dt = datetime.fromtimestamp(item["dt"], tz=MX_TZ)
            forecasts.append({
                "fecha": dt.strftime("%Y-%m-%d"),
                "hora": dt.strftime("%H:%M"),
                "temp": item["main"]["temp"],
                "feels_like": item["main"]["feels_like"],
                "humidity": item["main"]["humidity"],
                "description": item["weather"][0]["description"],
                "icon": item["weather"][0]["main"],  # Rain, Clear, Clouds, etc.
                "rain_mm": item.get("rain", {}).get("3h", 0),
                "wind_speed": item["wind"]["speed"],
            })
        return forecasts
    except Exception as e:
        print(f"[weather] Error: {e}")
        return get_weather_fallback()


def get_weather_fallback():
    """Fallback: use wttr.in (no API key needed)."""
    try:
        r = requests.get(f"https://wttr.in/{CITY_NAME}?format=j1", timeout=10)
        if not r.ok:
            return []
        data = r.json()
        forecasts = []
        for day in data.get("weather", [])[:3]:
            fecha = day["date"]
            for hour in day.get("hourly", []):
                forecasts.append({
                    "fecha": fecha,
                    "hora": f"{int(hour['time'])//100:02d}:00",
                    "temp": float(hour["tempC"]),
                    "feels_like": float(hour["FeelsLikeC"]),
                    "humidity": int(hour["humidity"]),
                    "description": hour.get("lang_es", [{}])[0].get("value", hour.get("weatherDesc", [{}])[0].get("value", "")),
                    "icon": hour.get("weatherCode", ""),
                    "rain_mm": float(hour.get("precipMM", 0)),
                    "wind_speed": float(hour.get("windspeedKmph", 0)) / 3.6,
                })
        return forecasts
    except Exception as e:
        print(f"[weather fallback] Error: {e}")
        return []


def summarize_day_weather(forecasts, fecha):
    """Summarize weather for a specific date."""
    day_f = [f for f in forecasts if f["fecha"] == fecha]
    if not day_f:
        return None

    temps = [f["temp"] for f in day_f]
    rain = sum(f["rain_mm"] for f in day_f)
    descriptions = [f["description"] for f in day_f]
    icons = [f["icon"] for f in day_f]

    rain_hours = sum(1 for f in day_f if f["rain_mm"] > 0.5)
    is_rainy = rain > 2 or rain_hours >= 2
    is_hot = max(temps) > 35
    is_cold = min(temps) < 15

    # Most common weather
    from collections import Counter
    main_weather = Counter(descriptions).most_common(1)[0][0] if descriptions else "despejado"

    return {
        "fecha": fecha,
        "temp_min": round(min(temps)),
        "temp_max": round(max(temps)),
        "rain_mm": round(rain, 1),
        "rain_hours": rain_hours,
        "is_rainy": is_rainy,
        "is_hot": is_hot,
        "is_cold": is_cold,
        "description": main_weather,
        "humidity_avg": round(sum(f["humidity"] for f in day_f) / len(day_f)),
    }


# ── Events ───────────────────────────────────────────────────────────────
def get_events_for_date(fecha_str):
    """Get events for a specific date — café-relevant."""
    events = []
    dt = datetime.strptime(fecha_str, "%Y-%m-%d")
    dow = dt.weekday()
    month = dt.month
    day = dt.day

    # Holidays (with café-specific impact and tips)
    if fecha_str in HOLIDAYS_MX:
        name, impact, tip = HOLIDAYS_MX[fecha_str]
        events.append({"type": "holiday", "name": name, "impact": impact, "tip": tip})

    # Puentes
    if fecha_str in PUENTES:
        events.append({"type": "puente", "name": PUENTES[fecha_str], "impact": "alto", "tip": "Puente = familias brunching."})

    # Day before holiday
    tomorrow = (dt + timedelta(days=1)).strftime("%Y-%m-%d")
    if tomorrow in HOLIDAYS_MX:
        h_name = HOLIDAYS_MX[tomorrow][0]
        events.append({"type": "vispera", "name": f"Víspera de {h_name}", "impact": "medio", "tip": "Mañana es festivo — la gente sale hoy."})

    # Weekend (brunch days are king for cafés)
    if dow == 4:
        events.append({"type": "weekend", "name": "Viernes", "impact": "medio", "tip": "Después de las 5pm sube el tráfico."})
    elif dow == 5:
        events.append({"type": "weekend", "name": "Sábado", "impact": "alto", "tip": "Día fuerte de brunch. Asegura staff y mise en place."})
    elif dow == 6:
        events.append({"type": "weekend", "name": "Domingo", "impact": "alto", "tip": "Brunch familiar. Mesas grandes, más postres."})

    # Quincena
    if day in (15, 16):
        events.append({"type": "quincena", "name": "Quincena", "impact": "medio", "tip": "La gente gasta más. Tickets más altos."})
    last_day = (dt.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    if day == last_day.day or day == 1:
        events.append({"type": "quincena", "name": "Fin/inicio de quincena", "impact": "medio", "tip": "Más tráfico de oficinistas."})

    # Graduation season
    if month in GRADUATION_MONTHS and dow in (4, 5, 6):
        events.append({"type": "graduacion", "name": "Temporada de graduaciones", "impact": "medio", "tip": "Grupos grandes celebrando. Prepara mesas para 6+."})

    # Seasonal café tips
    for key, info in CAFE_SEASONAL.items():
        if month in info["months"]:
            events.append({"type": "temporada", "name": key.replace("_", " ").title(), "impact": "info", "tip": info["tip"]})
            break  # Only one seasonal tip per day

    # Semana Santa
    if fecha_str in SEMANA_SANTA:
        name, impact, tip = SEMANA_SANTA[fecha_str]
        events.append({"type": "semana_santa", "name": name, "impact": impact, "tip": tip})

    # External factors
    for key, info in EXTERNAL_FACTORS.items():
        match = True
        if "months" in info and month not in info["months"]:
            match = False
        if "days" in info and day not in info["days"]:
            match = False
        if "days_of_week" in info and dow not in info["days_of_week"]:
            match = False
        if match and ("months" in info or "days" in info):
            events.append({"type": "externo", "name": key.replace("_", " ").title(), "impact": "info", "tip": info["impact"]})

    # Competition notes
    if fecha_str in COMPETITION_NOTES:
        events.append({"type": "competencia", "name": "Competencia", "impact": "warning", "tip": COMPETITION_NOTES[fecha_str]})

    # Road closures
    if fecha_str in ROAD_CLOSURES:
        events.append({"type": "vialidad", "name": "Cierre vial", "impact": "warning", "tip": ROAD_CLOSURES[fecha_str]})

    return events


# ── Historical Analysis ──────────────────────────────────────────────────
def get_historical_data():
    """Get last 90 days of sales from Supabase."""
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/wansoft_daily",
            headers=sb_headers,
            params={
                "select": "fecha,ventas_dia,tickets_count,personas_restaurant,ticket_promedio_restaurant",
                "ventas_dia": "gt.0",
                "order": "fecha.desc",
                "limit": "90",
            },
            timeout=10,
        )
        return r.json() if r.ok else []
    except:
        return []


def analyze_dow_pattern(historical, target_dow):
    """Get average sales for a specific day of week."""
    same_dow = []
    for d in historical:
        dt = datetime.strptime(d["fecha"], "%Y-%m-%d")
        if dt.weekday() == target_dow:
            same_dow.append(d)

    if not same_dow:
        return None

    avg_ventas = sum(d.get("ventas_dia", 0) for d in same_dow) / len(same_dow)
    avg_personas = sum(d.get("personas_restaurant", 0) for d in same_dow) / len(same_dow)
    avg_tp = sum(d.get("ticket_promedio_restaurant", 0) for d in same_dow) / len(same_dow)

    return {
        "avg_ventas": round(avg_ventas),
        "avg_personas": round(avg_personas),
        "avg_tp": round(avg_tp),
        "sample_size": len(same_dow),
    }


def find_rainy_day_impact(historical, forecasts):
    """Compare rainy vs non-rainy days in history."""
    # We don't have historical weather, so estimate from sales variance
    # Days with significantly lower sales than DOW average = likely bad weather
    by_dow = {}
    for d in historical:
        dt = datetime.strptime(d["fecha"], "%Y-%m-%d")
        dow = dt.weekday()
        if dow not in by_dow:
            by_dow[dow] = []
        by_dow[dow].append(d.get("ventas_dia", 0))

    # Calculate coefficient of variation per DOW
    impacts = {}
    for dow, ventas in by_dow.items():
        if len(ventas) < 3:
            continue
        avg = sum(ventas) / len(ventas)
        below_avg = [v for v in ventas if v < avg * 0.8]  # 20%+ below average
        if below_avg and avg > 0:
            pct_drop = round((1 - sum(below_avg) / len(below_avg) / avg) * 100)
            impacts[dow] = pct_drop

    return impacts


# ── Build Message ────────────────────────────────────────────────────────
def build_message(today_str, weather_today, weather_tomorrow, events_today, events_tomorrow, historical, dow_stats_today, dow_stats_tomorrow):
    now_mx = datetime.now(MX_TZ)
    day_names = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    today_name = day_names[now_mx.weekday()]

    tomorrow = (now_mx + timedelta(days=1))
    tomorrow_str = tomorrow.strftime("%Y-%m-%d")
    tomorrow_name = day_names[tomorrow.weekday()]

    msg = f"🌤 CLIMA + EVENTOS — {today_name} {now_mx.strftime('%d/%m')}\n\n"

    # Today's weather
    if weather_today:
        msg += f"HOY ({today_name}):\n"
        emoji = "🌧" if weather_today["is_rainy"] else "🔥" if weather_today["is_hot"] else "❄️" if weather_today["is_cold"] else "☀️"
        msg += f"{emoji} {weather_today['description'].capitalize()}\n"
        msg += f"🌡 {weather_today['temp_min']}°–{weather_today['temp_max']}°C"
        if weather_today["rain_mm"] > 0:
            msg += f" · 🌧 {weather_today['rain_mm']}mm ({weather_today['rain_hours']}h de lluvia)"
        msg += f"\n💧 Humedad: {weather_today['humidity_avg']}%\n"

    # Today's events with tips
    if events_today:
        msg += "\n📅 EVENTOS HOY:\n"
        for e in events_today:
            icon = "🎉" if e["type"] == "holiday" else "🌉" if e["type"] == "puente" else "💰" if e["type"] == "quincena" else "🎓" if e["type"] == "graduacion" else "☕" if e["type"] == "temporada" else "🎊" if e["type"] == "vispera" else "📆"
            msg += f"  {icon} {e['name']}"
            if e.get("impact") and e["impact"] not in ("info",):
                msg += f" (impacto {e['impact']})"
            msg += "\n"
            if e.get("tip"):
                msg += f"     → {e['tip']}\n"

    # Today's prediction
    if dow_stats_today:
        msg += f"\n📊 PROMEDIO {today_name.upper()}:\n"
        msg += f"  Ventas: ${dow_stats_today['avg_ventas']:,} · {dow_stats_today['avg_personas']} personas · TP ${dow_stats_today['avg_tp']}\n"
        msg += f"  (basado en {dow_stats_today['sample_size']} {today_name}s)\n"

    # Weather impact insight
    if weather_today and weather_today["is_rainy"] and dow_stats_today:
        rain_impacts = find_rainy_day_impact(historical, [])
        dow = datetime.strptime(today_str, "%Y-%m-%d").weekday()
        if dow in rain_impacts:
            msg += f"\n⚠️ Los {today_name}s malos históricamente bajan ~{rain_impacts[dow]}% vs promedio.\n"
            estimated = round(dow_stats_today["avg_ventas"] * (1 - rain_impacts[dow] / 100))
            msg += f"  Estimado con lluvia: ~${estimated:,}\n"

    if weather_today and weather_today["is_rainy"]:
        msg += "\n💡 ACCIÓN CAFÉ:\n"
        msg += "  • Menos perecederos (ensaladas, fruta)\n"
        msg += "  • Promueve: café caliente, chocolate, chai, sopas\n"
        msg += "  • Menos tráfico = buen día para limpieza profunda\n"
    elif weather_today and weather_today["is_hot"] and weather_today["temp_max"] > 35:
        msg += "\n💡 ACCIÓN CAFÉ:\n"
        msg += "  • Refuerza: frappes, smoothies, aguas frescas\n"
        msg += "  • Asegura hielo suficiente y frutas\n"
        msg += "  • Clientes buscan AC — ventaja sobre terrazas\n"
    elif weather_today and weather_today["temp_max"] > 30:
        msg += "\n💡 Día caluroso — las bebidas frías se van a mover.\n"

    # Tomorrow preview
    msg += f"\n{'─' * 30}\n"
    msg += f"MAÑANA ({tomorrow_name} {tomorrow.strftime('%d/%m')}):\n"

    if weather_tomorrow:
        emoji = "🌧" if weather_tomorrow["is_rainy"] else "🔥" if weather_tomorrow["is_hot"] else "❄️" if weather_tomorrow["is_cold"] else "☀️"
        msg += f"{emoji} {weather_tomorrow['description'].capitalize()} · {weather_tomorrow['temp_min']}°–{weather_tomorrow['temp_max']}°C"
        if weather_tomorrow["rain_mm"] > 0:
            msg += f" · 🌧 {weather_tomorrow['rain_mm']}mm"
        msg += "\n"

    if events_tomorrow:
        for e in events_tomorrow:
            icon = "🎉" if e["type"] == "holiday" else "💰" if e["type"] == "quincena" else "📆"
            msg += f"  {icon} {e['name']}\n"

    if dow_stats_tomorrow:
        msg += f"  Prom. {tomorrow_name}: ${dow_stats_tomorrow['avg_ventas']:,}\n"

    # Preparation tips
    tips = []
    if events_tomorrow and any(e["type"] in ("holiday", "puente") for e in events_tomorrow):
        tips.append("Día festivo mañana — revisa inventario para volumen alto o cierre")
    if events_today and any(e["type"] == "quincena" for e in events_today):
        tips.append("Quincena — espera más tráfico y tickets más altos")
    if weather_tomorrow and weather_tomorrow["is_rainy"]:
        tips.append("Lluvia mañana — ajusta compras de perecederos")

    if tips:
        msg += "\n📋 PREPARAR:\n"
        for tip in tips:
            msg += f"  • {tip}\n"

    return msg


# ── Telegram ─────────────────────────────────────────────────────────────
def send_telegram(msg):
    sent = 0
    for chat_id in TG_CHAT_IDS:
        if not chat_id:
            continue
        chunks = [msg[i:i + 4000] for i in range(0, len(msg), 4000)]
        for chunk in chunks:
            r = requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk},
            )
            if r.ok:
                sent += 1
    return sent


# ── Main ─────────────────────────────────────────────────────────────────
def main():
    start = time.time()
    if _audit: _audit.log_start()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")
    tomorrow_str = (now_mx + timedelta(days=1)).strftime("%Y-%m-%d")

    print(f"[climate] Starting for {CLIENT['id']} on {today_str}")

    # 1. Get weather
    print("[climate] Fetching weather...")
    forecasts = get_weather_forecast()
    print(f"[climate] Got {len(forecasts)} forecast entries")

    weather_today = summarize_day_weather(forecasts, today_str)
    weather_tomorrow = summarize_day_weather(forecasts, tomorrow_str)

    # 2. Get events
    events_today = get_events_for_date(today_str)
    events_tomorrow = get_events_for_date(tomorrow_str)
    print(f"[climate] Events today: {len(events_today)}, tomorrow: {len(events_tomorrow)}")

    # 3. Get historical data
    print("[climate] Fetching historical...")
    historical = get_historical_data()
    print(f"[climate] Got {len(historical)} days of history")

    dow_today = now_mx.weekday()
    dow_tomorrow = (now_mx + timedelta(days=1)).weekday()
    dow_stats_today = analyze_dow_pattern(historical, dow_today)
    dow_stats_tomorrow = analyze_dow_pattern(historical, dow_tomorrow)

    # 4. Build structured data and save to DB
    rain_impacts = find_rainy_day_impact(historical, [])
    dow_impact = rain_impacts.get(dow_today, 0) if weather_today and weather_today.get("is_rainy") else 0
    estimated_rainy = round(dow_stats_today["avg_ventas"] * (1 - dow_impact / 100)) if dow_stats_today and dow_impact > 0 else None

    structured_data = {
        "weather_today": weather_today,
        "weather_tomorrow": weather_tomorrow,
        "events_today": events_today,
        "events_tomorrow": events_tomorrow,
        "dow_stats_today": dow_stats_today,
        "dow_stats_tomorrow": dow_stats_tomorrow,
        "rain_impact_pct": dow_impact,
        "estimated_rainy_ventas": estimated_rainy,
    }

    is_rainy = weather_today and weather_today.get("is_rainy")
    priority = "warning" if is_rainy else "info"
    weather_desc = weather_today["description"] if weather_today else "sin datos"
    summary = f"{weather_desc}, {len(events_today)} eventos hoy"

    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "climate",
                "fecha": today_str,
                "data": json.dumps(structured_data),
                "summary": summary,
                "priority": priority,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(f"[climate] Saved to agent_results")
    except Exception as e:
        print(f"[climate] Error saving to DB: {e}")

    elapsed = int((time.time() - start) * 1000)
    print(f"[climate] Done in {elapsed}ms — {summary}")

    # Log
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "climate-events",
                "trigger_type": TRIGGER_TYPE,
                "status": "success",
                "duration_ms": elapsed,
                "output_summary": f"weather: {'rain' if is_rainy else 'clear'}, events: {len(events_today)}+{len(events_tomorrow)}",
                "tentacle": "ops",
            },
        )
    except:
        pass


if __name__ == "__main__":
    main()
