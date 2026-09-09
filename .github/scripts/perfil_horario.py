#!/usr/bin/env python3
"""El perfil horario de UN restaurante — qué es "normal" para él, no para AMALAY.

EL PROBLEMA QUE RESUELVE
`close_predictor.HOURLY_DISTRIBUTION` es una curva fija con el comentario admitiéndolo:
"adjusted for AMALAY brunch café". Todo restaurante que no sea un café de brunch recibe
proyecciones medidas contra un ritmo ajeno. Una taquería con pico de cena, a las 3pm,
escucha "llevas el 86% de tu día" cuando apenas va a empezar.

Y hay una ironía que ordena la prioridad: medido el 2026-09-09, **AMALAY tiene 3 días de
datos en `ops_hourly`** —opera en Wansoft— mientras `lab-resto` tiene 116 y `diezmex-demo`
91. El restaurante cuya curva es el default de todos es el que menos datos propios tiene.

LA REGLA QUE NO SE ROMPE
docs/ai/ARQUITECTURA-CRUCE.md, regla 7: "Lo que es normal se aprende por restaurante.
Ningún umbral ni curva de un cliente puede ser el default de otro." Por eso las curvas de
arranque de abajo son de forma de servicio genérica y están marcadas como tales — no son
la curva de nadie. Copiar la de `lab-resto` como default sería repetir el error con otro
nombre.

Y su corolario: **mientras el perfil no sea propio, se dice.** `Perfil.fuente` viaja con la
curva justamente para que quien la use pueda decirlo. "Con tu primera semana de datos,
proyecto X" es honesto y útil; "vas 20% abajo" sin decir contra qué, cuando el contra-qué
es otro restaurante, es mentir.

Uso:
    from perfil_horario import perfil_horario
    p = perfil_horario(client_row)      # client_row = fila de `clients`
    p.acumulado_a(14)                   # % del día que ya debió pasar a las 14h
    p.fuente                            # 'propio' | 'mezcla' | 'tipo:cafe' ...
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

try:
    import requests
except ImportError:  # el import se resuelve en runtime; las pruebas lo mockean
    requests = None  # type: ignore

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# ── Etapas del arranque en frío ─────────────────────────────────────────────
# Un restaurante nuevo no tiene historia, y es justo cuando más necesita que la IA se vea
# útil. Tres etapas, con el peso propio subiendo cada día.
DIAS_MINIMOS_PROPIO = 60   # de aquí en adelante, su historia manda sola
DIAS_MINIMOS_MEZCLA = 15   # antes de esto, no hay señal suficiente para pesar nada

# ── Curvas de arranque, por FORMA DE SERVICIO ───────────────────────────────
# Fracción del día por hora local (suman 1.0). No son de ningún cliente: describen la
# forma que tiene un servicio, que es lo poco que se puede saber de un restaurante el día
# que abre. En cuanto tenga datos propios, dejan de usarse.
CURVAS_ARRANQUE: dict[str, dict[int, float]] = {
    # Desayuno y media mañana. Cierra temprano.
    "cafe": {7: .05, 8: .10, 9: .13, 10: .15, 11: .14, 12: .12, 13: .10,
             14: .07, 15: .05, 16: .04, 17: .03, 18: .02},
    # Dos picos claros: comida fuerte y cena.
    "restaurante": {12: .08, 13: .14, 14: .16, 15: .11, 16: .05, 17: .04,
                    18: .06, 19: .12, 20: .13, 21: .07, 22: .04},
    # Plano y largo; sin picos marcados.
    "fast_food": {10: .04, 11: .07, 12: .11, 13: .12, 14: .10, 15: .07, 16: .06,
                  17: .07, 18: .09, 19: .11, 20: .09, 21: .05, 22: .02},
    # Comedor industrial: desayuno y comida por turno, cierra a media tarde.
    "comedor": {6: .08, 7: .16, 8: .18, 9: .10, 10: .06, 11: .08,
                12: .14, 13: .12, 14: .06, 15: .02},
    # Todo en la noche.
    "bar": {17: .04, 18: .08, 19: .13, 20: .16, 21: .17, 22: .16, 23: .13,
            0: .08, 1: .05},
}

# `clients.type` es texto libre y hoy trae de todo: "Brunch and Cafe", "Café & Brunch",
# "casual_dining", "Pollo frito · fast food", "Comedores industriales". Se normaliza por
# palabras, en el orden en que están: lo más específico primero.
_PALABRAS = [
    ("comedor",     ("comedor", "industrial", "cafeteria empresarial")),
    ("cafe",        ("cafe", "café", "coffee", "brunch", "desayun", "panader", "reposter")),
    ("fast_food",   ("fast food", "fast_food", "rapida", "rápida", "pollo frito",
                     "hamburgues", "pizzer", "taquer", "food truck")),
    ("bar",         ("bar", "cantina", "cerveceria", "cervecería", "pub", "antro")),
    ("restaurante", ("restaurant", "restaurante", "casual", "fine dining", "grupo",
                     "marisquer", "steak", "sushi", "cocina")),
]

FAMILIA_POR_DEFECTO = "restaurante"


def familia_de(tipo: str | None) -> str:
    """Normaliza `clients.type` a una forma de servicio.

    Sin tipo o sin coincidencia devuelve 'restaurante': es la forma más común y la de dos
    picos, así que equivocarse hacia ella es el error más barato. Que un tipo no mapee NO
    es un fallo — es un tipo nuevo, y el perfil propio lo va a corregir en 15 días.
    """
    if not tipo:
        return FAMILIA_POR_DEFECTO
    t = re.sub(r"\s+", " ", str(tipo).strip().lower())
    for familia, palabras in _PALABRAS:
        if any(p in t for p in palabras):
            return familia
    return FAMILIA_POR_DEFECTO


# El día de negocio arranca a las 05:00 — el mismo corte con el que la base escribe
# `pos_orders.dia_venta` (20260901180000_folio_por_dia_de_venta.sql). El acumulado tiene
# que recorrerse en ESE orden, no de 0 a 23.
#
# No es un detalle: un bar vende de 17h a 2am. Acumulando por hora de reloj, sus horas 0 y
# 1 caen al PRINCIPIO del día y la curva dice que a las 14:00 lleva el 13% vendido, cuando
# todavía no abre. Lo encontró la prueba que compara un bar contra un comedor.
HORA_INICIO_DIA = 5
_ORDEN_DEL_DIA = [(HORA_INICIO_DIA + i) % 24 for i in range(24)]


def _acumular(fracciones: dict[int, float]) -> dict[int, float]:
    """{hora: fracción} → {hora: % acumulado al TERMINAR esa hora}, normalizado a 1.0.

    Se recorre en orden de día de negocio (05:00 → 04:59), así que una hora de madrugada
    queda al FINAL del día que la produjo, no al principio del siguiente.
    """
    total = sum(v for v in fracciones.values() if v > 0)
    if total <= 0:
        return {}
    acc, corriendo = {}, 0.0
    for h in _ORDEN_DEL_DIA:
        corriendo += max(0.0, fracciones.get(h, 0.0)) / total
        acc[h] = round(min(1.0, corriendo), 4)
    return acc


@dataclass
class Perfil:
    """La curva y, con el mismo peso, de dónde salió."""
    acumulado: dict[int, float]
    fuente: str                  # 'propio' | 'mezcla' | 'tipo:<familia>'
    dias_de_datos: int
    familia: str
    peso_propio: float = 0.0     # 0.0 = todo de la curva de arranque; 1.0 = todo suyo
    avisos: list[str] = field(default_factory=list)

    @property
    def es_propio(self) -> bool:
        return self.fuente == "propio"

    def acumulado_a(self, hora: int) -> float:
        """% del día que ya debió pasar al terminar esa hora."""
        return self.acumulado.get(hora % 24, 1.0)

    def como_frase(self) -> str:
        """Cómo describirle al usuario contra qué se le está midiendo. La regla dice que
        mientras el perfil no sea propio hay que decirlo; esto es para no tener que
        inventar la frase en cada llamada."""
        if self.fuente == "propio":
            return f"con tus últimos {self.dias_de_datos} días"
        if self.fuente == "mezcla":
            return (f"con tus {self.dias_de_datos} días de historia, mezclados con un "
                    f"patrón de {self.familia} — todavía no es tu curva completa")
        return (f"con un patrón genérico de {self.familia}: llevas {self.dias_de_datos} "
                f"día(s) de datos y aún no hay historia propia")


def _leer_ops_hourly(client_id: str, dias: int, fetch=None) -> list[dict]:
    """Lee la vista del contrato. Nunca lanza: sin datos, el perfil cae a la curva de
    arranque, que es un resultado válido y no un error."""
    if fetch is None:
        if not (requests and SUPABASE_URL and SUPABASE_KEY):
            return []
        def fetch(url, headers):  # noqa: E306
            r = requests.get(url, headers=headers, timeout=30)
            r.raise_for_status()
            return r.json()
    url = (f"{SUPABASE_URL.rstrip('/')}/rest/v1/ops_hourly"
           f"?client_id=eq.{client_id}&select=dia_venta,hora,ventas&limit=10000")
    try:
        filas = fetch(url, {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
        return filas if isinstance(filas, list) else []
    except Exception:
        return []


def perfil_horario(client: dict, dias: int = 90, fetch=None) -> Perfil:
    """Perfil de UN restaurante. `client` es su fila de `clients` (id y type).

    Nunca lanza y nunca devuelve una curva vacía: sin datos propios entrega la de arranque
    de su forma de servicio, diciéndolo en `fuente`.
    """
    client_id = str(client.get("id") or "")
    familia = familia_de(client.get("type"))
    base = CURVAS_ARRANQUE.get(familia, CURVAS_ARRANQUE[FAMILIA_POR_DEFECTO])
    acc_base = _acumular(base)

    filas = _leer_ops_hourly(client_id, dias, fetch) if client_id else []

    por_hora: dict[int, float] = {}
    dias_vistos: set[str] = set()
    for f in filas:
        try:
            h = int(f.get("hora"))
            v = float(f.get("ventas") or 0)
        except (TypeError, ValueError):
            continue
        if f.get("dia_venta"):
            dias_vistos.add(str(f["dia_venta"]))
        if not (0 <= h <= 23) or v <= 0:
            continue
        por_hora[h] = por_hora.get(h, 0.0) + v

    n = len(dias_vistos)

    if n < DIAS_MINIMOS_MEZCLA or not por_hora:
        avisos = []
        if n and not por_hora:
            avisos.append("hay días registrados pero ninguno con ventas > 0")
        return Perfil(acumulado=acc_base, fuente=f"tipo:{familia}", dias_de_datos=n,
                      familia=familia, peso_propio=0.0, avisos=avisos)

    acc_propio = _acumular(por_hora)

    if n >= DIAS_MINIMOS_PROPIO:
        return Perfil(acumulado=acc_propio, fuente="propio", dias_de_datos=n,
                      familia=familia, peso_propio=1.0)

    # Mezcla: el peso propio sube linealmente entre las dos fronteras. Se mezclan las
    # curvas ACUMULADAS y no las fracciones porque el acumulado es lo que se consulta, y
    # mezclar acumulados monótonos da un acumulado monótono — mezclar fracciones y luego
    # acumular puede desordenar la curva en las horas de frontera.
    w = (n - DIAS_MINIMOS_MEZCLA) / (DIAS_MINIMOS_PROPIO - DIAS_MINIMOS_MEZCLA)
    w = max(0.0, min(1.0, w))
    mezclado = {h: round(acc_propio.get(h, 0.0) * w + acc_base.get(h, 0.0) * (1 - w), 4)
                for h in range(24)}
    return Perfil(acumulado=mezclado, fuente="mezcla", dias_de_datos=n,
                  familia=familia, peso_propio=round(w, 3))


if __name__ == "__main__":  # diagnóstico manual
    import json
    import sys
    cid = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("CLIENT_ID", "")
    tipo = sys.argv[2] if len(sys.argv) > 2 else None
    p = perfil_horario({"id": cid, "type": tipo})
    print(json.dumps({"fuente": p.fuente, "dias": p.dias_de_datos, "familia": p.familia,
                      "peso_propio": p.peso_propio, "frase": p.como_frase(),
                      "acumulado": p.acumulado}, ensure_ascii=False, indent=2))
