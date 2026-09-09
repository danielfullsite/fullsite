#!/usr/bin/env python3
"""Pruebas del perfil horario — sin red.

Lo que se prueba es cuándo el perfil se atreve a decir "éste eres tú" y cuándo admite que
está midiendo con una curva ajena. Equivocarse hacia el lado optimista es el error caro:
es exactamente lo que hace hoy `HOURLY_DISTRIBUTION`, que mide a todos con el ritmo de un
café de brunch sin decirlo.

Las que más importan:
  · que sin datos NO se presente como propio (mentir sobre el contra-qué)
  · que la curva mezclada siga siendo monótona (una curva que baja da proyecciones locas)
  · que un tipo desconocido no reviente — es un cliente nuevo, no un fallo
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import perfil_horario as ph  # noqa: E402


def filas(dias: int, reparto: dict[int, float]) -> list[dict]:
    """`dias` días distintos, cada uno con el mismo reparto por hora."""
    out = []
    for d in range(dias):
        for hora, v in reparto.items():
            out.append({"dia_venta": f"2026-07-{d + 1:02d}", "hora": hora, "ventas": v})
    return out


def perfil(client, datos):
    return ph.perfil_horario(client, fetch=lambda url, headers: datos)


class NormalizarElTipo(unittest.TestCase):
    def test_los_tipos_reales_de_la_base(self):
        # Medidos en producción el 2026-09-09. Texto libre, dos idiomas, snake_case y prosa.
        casos = {
            "Brunch and Cafe": "cafe",
            "Café & Brunch": "cafe",
            "Specialty Coffee": "cafe",
            "Comedores industriales": "comedor",
            "Pollo frito · fast food": "fast_food",
            "fast_food": "fast_food",
            "casual_dining": "restaurante",
            "Restaurant & Bar": "bar",      # "bar" es más específico y va antes
            "Grupo restaurantero": "restaurante",
            "restaurant": "restaurante",
        }
        for tipo, esperado in casos.items():
            self.assertEqual(ph.familia_de(tipo), esperado, f"tipo: {tipo}")

    def test_un_tipo_desconocido_no_revienta(self):
        # Un cliente nuevo con un giro que nadie previó no es un fallo: es un cliente
        # nuevo, y en 15 días su perfil propio lo corrige.
        self.assertEqual(ph.familia_de("Heladería artesanal marciana"), "restaurante")

    def test_sin_tipo(self):
        self.assertEqual(ph.familia_de(None), "restaurante")
        self.assertEqual(ph.familia_de(""), "restaurante")


class LasTresEtapas(unittest.TestCase):
    def test_sin_datos_usa_la_curva_de_su_tipo_y_LO_DICE(self):
        p = perfil({"id": "nuevo", "type": "Café & Brunch"}, [])
        self.assertEqual(p.fuente, "tipo:cafe")
        self.assertFalse(p.es_propio)
        self.assertEqual(p.peso_propio, 0.0)
        self.assertIn("genérico", p.como_frase())

    def test_pocos_dias_sigue_sin_ser_propio(self):
        p = perfil({"id": "x", "type": "restaurant"}, filas(14, {13: 100.0}))
        self.assertTrue(p.fuente.startswith("tipo:"))
        self.assertEqual(p.dias_de_datos, 14)

    def test_a_los_15_dias_empieza_a_mezclar(self):
        p = perfil({"id": "x", "type": "restaurant"}, filas(15, {13: 100.0}))
        self.assertEqual(p.fuente, "mezcla")
        self.assertAlmostEqual(p.peso_propio, 0.0, places=2)  # arranca pesando casi nada

    def test_a_mitad_de_camino_pesa_la_mitad(self):
        p = perfil({"id": "x", "type": "restaurant"}, filas(38, {13: 100.0}))
        self.assertEqual(p.fuente, "mezcla")
        self.assertAlmostEqual(p.peso_propio, 0.51, places=1)

    def test_a_los_60_el_perfil_es_suyo(self):
        p = perfil({"id": "x", "type": "restaurant"}, filas(60, {13: 100.0}))
        self.assertEqual(p.fuente, "propio")
        self.assertEqual(p.peso_propio, 1.0)
        self.assertIn("tus últimos 60 días", p.como_frase())

    def test_dias_con_cero_ventas_no_cuentan_como_historia(self):
        p = perfil({"id": "x", "type": "restaurant"}, filas(90, {13: 0.0}))
        self.assertTrue(p.fuente.startswith("tipo:"))
        self.assertIn("ninguno con ventas", " ".join(p.avisos))


class LaCurvaEsUsable(unittest.TestCase):
    def _monotona(self, acc):
        # En orden de día de negocio, no de reloj.
        valores = [acc[h] for h in ph._ORDEN_DEL_DIA]
        for a, b in zip(valores, valores[1:]):
            self.assertLessEqual(a, b + 1e-9, f"la curva baja: {valores}")

    def test_toda_curva_de_arranque_es_monotona_y_cierra_en_1(self):
        for familia in ph.CURVAS_ARRANQUE:
            p = perfil({"id": "x", "type": familia}, [])
            self._monotona(p.acumulado)
            self.assertAlmostEqual(p.acumulado[ph._ORDEN_DEL_DIA[-1]], 1.0, places=3, msg=familia)

    def test_la_curva_propia_es_monotona(self):
        p = perfil({"id": "x", "type": "restaurant"},
                   filas(70, {12: 30.0, 13: 50.0, 19: 40.0, 20: 60.0}))
        self._monotona(p.acumulado)
        self.assertAlmostEqual(p.acumulado[ph._ORDEN_DEL_DIA[-1]], 1.0, places=3)

    def test_la_MEZCLA_tambien_es_monotona(self):
        # El motivo de mezclar acumulados y no fracciones. Una curva que baja daría
        # proyecciones negativas o absurdas en las horas de frontera.
        p = perfil({"id": "x", "type": "cafe"},
                   filas(30, {19: 50.0, 20: 60.0, 21: 40.0}))  # cena, contra curva de café
        self.assertEqual(p.fuente, "mezcla")
        self._monotona(p.acumulado)

    def test_el_perfil_distingue_formas_de_verdad(self):
        # Un comedor y un bar no pueden dar el mismo progreso a las 14h.
        comedor = perfil({"id": "a", "type": "Comedores industriales"}, [])
        bar = perfil({"id": "b", "type": "cantina"}, [])
        self.assertGreater(comedor.acumulado_a(14), 0.85)
        self.assertLess(bar.acumulado_a(14), 0.05)

    def test_el_caso_que_motiva_todo_esto(self):
        # Una taquería de cena, a las 3pm, NO lleva el 86% de su día — que es lo que le
        # dice hoy la curva de AMALAY.
        taqueria = perfil({"id": "t", "type": "taquería"}, [])
        self.assertLess(taqueria.acumulado_a(15), 0.60)


class NuncaRevienta(unittest.TestCase):
    def test_una_lectura_que_falla_cae_a_la_curva_de_arranque(self):
        def explota(url, headers):
            raise RuntimeError("500")
        p = ph.perfil_horario({"id": "x", "type": "cafe"}, fetch=explota)
        self.assertTrue(p.fuente.startswith("tipo:"))
        self.assertAlmostEqual(p.acumulado[ph._ORDEN_DEL_DIA[-1]], 1.0, places=3)

    def test_filas_basura_se_ignoran_sin_tirar_el_perfil(self):
        datos = filas(70, {13: 100.0}) + [
            {"dia_venta": "2026-07-01", "hora": "no soy hora", "ventas": 10},
            {"dia_venta": "2026-07-01", "hora": 99, "ventas": 10},
            {"dia_venta": None, "hora": 13, "ventas": None},
        ]
        p = perfil({"id": "x", "type": "restaurant"}, datos)
        self.assertEqual(p.fuente, "propio")

    def test_sin_client_id_no_intenta_leer(self):
        p = ph.perfil_horario({"id": "", "type": "cafe"})
        self.assertTrue(p.fuente.startswith("tipo:"))

    def test_acumulado_a_acepta_cualquier_hora(self):
        p = perfil({"id": "x", "type": "cafe"}, [])
        self.assertLessEqual(p.acumulado_a(25), 1.0)
        self.assertGreaterEqual(p.acumulado_a(-1), 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
