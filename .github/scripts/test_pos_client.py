#!/usr/bin/env python3
"""Pruebas del cliente del POS — sin red.

LA QUE IMPORTA MÁS
`pagos_que_cuadran`. `save-order` exige, en centavos, `Σ pagos == total + propina`, y el
simulador ponía `monto = total` con la propina aparte. Medido el 2026-08-26: el 100% de
las órdenes cerradas del laboratorio (2,813 de 2,813 en lab-resto) serían rechazadas.

Esa función existe para que ese error no se pueda volver a escribir, y estas pruebas
existen para que la función no se pueda romper en silencio.

Y una que no es de lógica sino de disciplina: que ni el PIN ni el token salgan en el log.
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import pos_client as pc  # noqa: E402


def centavos(x) -> int:
    return round(float(x) * 100)


class ElPagoCuadraConLoQueElPOSExige(unittest.TestCase):
    def test_el_pago_es_la_cuenta_MAS_la_propina(self):
        pagos = pc.pagos_que_cuadran(total=232.00, propina=30.00, metodo="Efectivo")
        self.assertEqual(centavos(pagos[0]["monto"]), centavos(232.00) + centavos(30.00))

    def test_el_error_viejo_NO_pasaria(self):
        # Lo que escribía el simulador: monto = total, propina aparte.
        total, propina = 232.00, 30.00
        viejo = centavos(total)
        self.assertNotEqual(viejo, centavos(total) + centavos(propina),
                            "si esto empatara, el invariante no probaría nada")
        nuevo = centavos(pc.pagos_que_cuadran(total, propina, "Efectivo")[0]["monto"])
        self.assertEqual(nuevo, centavos(total) + centavos(propina))

    def test_sin_propina_el_pago_es_el_total(self):
        pagos = pc.pagos_que_cuadran(total=100.0, propina=0.0, metodo="Tarjeta")
        self.assertEqual(centavos(pagos[0]["monto"]), centavos(100.0))

    def test_cuadra_en_centavos_con_importes_feos(self):
        # save-order compara en CENTAVOS enteros. Un redondeo a la baja aquí produce
        # PAYMENT_MISMATCH y la orden no se cierra.
        for total, propina in ((1888.00, 245.44), (33.33, 4.99), (7.77, 1.11),
                               (12345.67, 1851.85), (0.01, 0.0)):
            monto = pc.pagos_que_cuadran(total, propina, "X")[0]["monto"]
            self.assertEqual(centavos(monto), centavos(total) + centavos(propina),
                             f"no cuadra con total={total} propina={propina}")

    def test_conserva_el_metodo_de_pago(self):
        self.assertEqual(pc.pagos_que_cuadran(10, 1, "Transferencia")[0]["metodo"],
                         "Transferencia")


class NoSeFiltraNiElPINNiElToken(unittest.TestCase):
    def test_el_token_no_se_imprime_completo(self):
        from io import StringIO
        token = "ESTE-TOKEN-NO-DEBE-APARECER-EN-EL-LOG"
        resp = mock.Mock(ok=True)
        resp.json.return_value = {"shiftToken": token, "staff": {"name": "Ana", "role": "mesero"}}
        salida = StringIO()
        with mock.patch.object(pc.requests, "post", return_value=resp), \
             mock.patch("sys.stdout", salida):
            devuelto, _ = pc.autenticar("demo", "1234")
        self.assertEqual(devuelto, token)
        self.assertNotIn(token, salida.getvalue())
        self.assertIn(str(len(token)), salida.getvalue())  # sí dice su longitud

    def test_sin_PIN_falla_antes_de_pedir_nada(self):
        with mock.patch.object(pc.requests, "post") as post:
            with self.assertRaises(pc.ErrorPOS):
                pc.autenticar("demo", "")
            post.assert_not_called()

    def test_si_el_POS_no_devuelve_token_se_dice_claro(self):
        resp = mock.Mock(ok=True)
        resp.json.return_value = {"staff": {}}
        with mock.patch.object(pc.requests, "post", return_value=resp):
            with self.assertRaises(pc.ErrorPOS) as ctx:
                pc.autenticar("demo", "1234")
        self.assertIn("shiftToken", str(ctx.exception))


class GuardarNoTragaErrores(unittest.TestCase):
    def _resp(self, ok=True, cuerpo=None, status=200):
        r = mock.Mock(ok=ok, status_code=status)
        r.json.return_value = cuerpo if cuerpo is not None else {"ok": True, "revision": 1}
        r.text = ""
        return r

    def test_una_respuesta_ok_devuelve_la_revision(self):
        with mock.patch.object(pc.requests, "post", return_value=self._resp()):
            self.assertEqual(pc.guardar("t", {"order_id": "o", "expected_revision": 0})["revision"], 1)

    def test_un_PAYMENT_MISMATCH_lanza_con_el_motivo(self):
        # El POS puede devolver HTTP 400 con ok:false. Tragarlo dejaría al simulador
        # creyendo que guardó — que es exactamente cómo se acumularon 2,813 órdenes malas.
        r = self._resp(ok=False, cuerpo={"ok": False, "error": "PAYMENT_MISMATCH"}, status=400)
        with mock.patch.object(pc.requests, "post", return_value=r):
            with self.assertRaises(pc.ErrorPOS) as ctx:
                pc.guardar("t", {"order_id": "o9", "expected_revision": 0})
        self.assertIn("PAYMENT_MISMATCH", str(ctx.exception))
        self.assertIn("o9", str(ctx.exception))

    def test_un_ok_false_con_HTTP_200_tambien_lanza(self):
        r = self._resp(ok=True, cuerpo={"ok": False, "error": "CONFLICT"})
        with mock.patch.object(pc.requests, "post", return_value=r):
            with self.assertRaises(pc.ErrorPOS):
                pc.guardar("t", {"order_id": "o", "expected_revision": 0})

    def test_pone_un_save_operation_id_para_que_el_reintento_no_duplique(self):
        capturado = {}
        def post_falso(url, json=None, headers=None, timeout=None):
            capturado.update(json or {})
            return self._resp()
        with mock.patch.object(pc.requests, "post", post_falso):
            pc.guardar("t", {"order_id": "o", "expected_revision": 0})
        self.assertIn("save_operation_id", capturado)

    def test_respeta_un_save_operation_id_dado(self):
        capturado = {}
        def post_falso(url, json=None, headers=None, timeout=None):
            capturado.update(json or {})
            return self._resp()
        with mock.patch.object(pc.requests, "post", post_falso):
            pc.guardar("t", {"order_id": "o", "expected_revision": 0, "save_operation_id": "mio"})
        self.assertEqual(capturado["save_operation_id"], "mio")


class Diagnostico(unittest.TestCase):
    def test_resume_lo_que_hizo_el_inventario(self):
        txt = pc.diagnostico_inventario({
            "inventory_status": "COMPLETE",
            "inventory_results": [{"r_applied": -0.022}, {"r_applied": -0.15}],
        })
        self.assertIn("COMPLETE", txt)
        self.assertIn("2 ingrediente", txt)

    def test_sin_inventario_lo_dice(self):
        self.assertIn("sin inventario", pc.diagnostico_inventario({}))


class LaURL(unittest.TestCase):
    def test_por_omision_apunta_a_produccion(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(pc.base_url(), "https://app.fullsite.mx")

    def test_se_puede_apuntar_a_otro_lado_sin_diagonal_final(self):
        with mock.patch.dict(os.environ, {"APP_URL": "https://preview.example.com/"}, clear=True):
            self.assertEqual(pc.base_url(), "https://preview.example.com")


if __name__ == "__main__":
    unittest.main(verbosity=2)
