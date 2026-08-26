#!/usr/bin/env python3
"""La curva horaria del simulador — sin tocar la base.

Lo que fija:

  1. APAGADA POR OMISIÓN. El lab (lab-resto) lleva meses con volumen parejo y este
     cambio no debe alterarlo. Si la curva se activara sola, cambiaría el
     comportamiento de un sistema que ya funciona — justo lo que NO se pidió.

  2. Encendida, el restaurante CIERRA de noche. El simulador nació generando el mismo
     volumen a toda hora: lab-resto tiene 109 órdenes a las 4am y 133 a las 5am, y sólo
     3 a las 6pm (medido 2026-08-26). Un restaurante que nunca cierra y está muerto en
     la cena es lo primero que un restaurantero nota que está mal en un demo.

  3. Los picos caen donde deben: comida y cena por encima del promedio, madrugada en
     cero.
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))

# El módulo habla con Supabase al importarse a través de agent_common; se neutraliza.
sys.modules.setdefault("requests", mock.MagicMock())
import lab_simulator as sim  # noqa: E402


def factor_a_las(hora: int, encendida: bool = True) -> float:
    entorno = {"TZ_LOCAL": "America/Monterrey"}
    if encendida:
        entorno["CURVA_HORARIA"] = "1"
    clase = type("FechaFalsa", (), {})
    with mock.patch.dict(os.environ, entorno, clear=True), \
         mock.patch.object(sim, "datetime") as dt:
        dt.now.return_value = mock.Mock(hour=hora)
        dt.utcnow.return_value = mock.Mock(hour=hora)
        return sim.factor_de_la_hora()


class ApagadaPorOmision(unittest.TestCase):
    def test_sin_la_variable_el_factor_es_1_a_cualquier_hora(self):
        # Lo más importante del archivo: el lab existente no cambia.
        for h in (3, 4, 5, 13, 20, 23):
            self.assertEqual(factor_a_las(h, encendida=False), 1.0,
                             f"la hora {h} cambió con la curva apagada")

    def test_un_valor_raro_en_la_variable_tampoco_la_enciende(self):
        with mock.patch.dict(os.environ, {"CURVA_HORARIA": "quizá"}, clear=True):
            self.assertEqual(sim.factor_de_la_hora(), 1.0)


class CierraDeNoche(unittest.TestCase):
    def test_de_medianoche_a_las_6_esta_cerrado(self):
        for h in range(0, 7):
            self.assertEqual(factor_a_las(h), 0.0, f"debería estar cerrado a las {h}")

    def test_a_las_7_ya_abrio(self):
        self.assertGreater(factor_a_las(7), 0.0)


class LosPicosCaenDondeDeben(unittest.TestCase):
    def test_la_comida_y_la_cena_estan_por_encima_del_promedio(self):
        activos = [f for f in sim.CURVA_RESTAURANTE if f > 0]
        promedio = sum(activos) / len(activos)
        for h in (13, 14, 19, 20):
            self.assertGreater(factor_a_las(h), promedio, f"la hora {h} debería ser pico")

    def test_la_cena_NO_esta_muerta_como_en_lab_resto(self):
        # El bug que se está corrigiendo: 6pm con 3 órdenes en total.
        self.assertGreater(factor_a_las(19), 1.0)
        self.assertGreater(factor_a_las(20), 1.0)

    def test_el_pico_maximo_es_una_hora_de_comer(self):
        maximo = max(sim.CURVA_RESTAURANTE)
        horas_pico = [h for h, f in enumerate(sim.CURVA_RESTAURANTE) if f == maximo]
        for h in horas_pico:
            self.assertIn(h, (12, 13, 14, 19, 20, 21), f"la hora {h} no es de comer")


class Robustez(unittest.TestCase):
    def test_la_curva_cubre_las_24_horas(self):
        self.assertEqual(len(sim.CURVA_RESTAURANTE), 24)

    def test_una_zona_horaria_invalida_no_truena(self):
        with mock.patch.dict(os.environ, {"CURVA_HORARIA": "1", "TZ_LOCAL": "Marte/Olympus"}, clear=True):
            self.assertIsInstance(sim.factor_de_la_hora(), float)

    def test_ningun_factor_es_negativo(self):
        self.assertTrue(all(f >= 0 for f in sim.CURVA_RESTAURANTE))


if __name__ == "__main__":
    unittest.main(verbosity=2)
