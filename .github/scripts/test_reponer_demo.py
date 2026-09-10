#!/usr/bin/env python3
"""El demo recibe mercancía cuando le hace falta, y sólo entonces. Sin red.

LO QUE FIJAN ESTAS PRUEBAS
Desde #366 cada venta descuenta inventario de verdad, y `r1_reconcile_item` lo hace SIN
tope ("allows negative"). El demo se vacía solo: medido el 2026-09-09 a ritmo de medio
día, el primer insumo llegaba a cero en 8.7 días.

En orden:
  1. Se repone SÓLO lo que cayó bajo su punto de reorden. Reponer todo cada vez dejaría
     el inventario clavado y el consumo invisible — que es lo único nuevo que el demo
     puede enseñar.
  2. Cada reposición deja su fila en `pos_inventory_movements`. Mover el saldo sin dejar
     rastro es la divergencia silenciosa que perseguimos tres veces esta semana.
  3. La entrada es POSITIVA y el consumo negativo, para que el signo distinga entrada de
     salida sin mirar el tipo.
  4. Un insumo sin nivel declarado no se rellena a ojo.
  5. Sólo tenants de prueba.
  6. El cruce consumo × venta sigue siendo posible: las entradas son de un tipo que se
     puede filtrar.
"""
from __future__ import annotations

import sys
import unittest
from contextlib import contextmanager
from io import StringIO
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
sys.modules.setdefault("requests", mock.MagicMock())

import reponer_demo as rd  # noqa: E402


@contextmanager
def silencio():
    with mock.patch("sys.stdout", StringIO()), mock.patch("sys.stderr", StringIO()):
        yield


def correr(filas, cid="demo"):
    """Corre `reponer` contra un inventario de mentira. Devuelve (resultado, parches,
    movimientos)."""
    parches, posts = [], []

    def sb_get_falso(tabla, params):
        return filas

    def sb_patch_falso(tabla, params, data):
        parches.append((tabla, params, data))

    def sb_post_falso(tabla, data, upsert=False):
        posts.extend(data if isinstance(data, list) else [data])

    with silencio(), \
            mock.patch.object(rd, "sb_get", sb_get_falso), \
            mock.patch.object(rd, "sb_patch", sb_patch_falso), \
            mock.patch.object(rd, "sb_post", sb_post_falso):
        res = rd.reponer(cid)
    return res, parches, posts


def insumo(ing, stock, punto=4.0, objetivo=21.0, unidad="kg"):
    return {"ingredient_id": ing, "stock": stock, "reorder_point": punto,
            "reorder_quantity": objetivo, "stock_unit": unidad}


# ── 1. Sólo lo que hace falta ────────────────────────────────────────────────

class ReponeLoJusto(unittest.TestCase):
    def test_no_toca_lo_que_va_sobrado(self):
        (repuestos, _), parches, posts = correr([insumo("cafe", 18.0)])
        self.assertEqual(repuestos, 0)
        self.assertEqual(parches, [])
        self.assertEqual(posts, [], "escribió un movimiento sin reponer nada")

    def test_repone_lo_que_cayo_bajo_el_punto(self):
        (repuestos, _), parches, _ = correr([insumo("cafe", 3.0)])
        self.assertEqual(repuestos, 1)
        self.assertEqual(parches[0][2]["stock"], 21.0)

    def test_justo_en_el_punto_todavia_no_se_repone(self):
        # `stock >= punto` no repone: el punto de reorden es el umbral, no el disparo.
        (repuestos, _), _, _ = correr([insumo("cafe", 4.0)])
        self.assertEqual(repuestos, 0)

    def test_levanta_lo_que_ya_estaba_en_negativo(self):
        (repuestos, negativos), parches, posts = correr([insumo("cafe", -7.5)])
        self.assertEqual((repuestos, negativos), (1, 1))
        self.assertEqual(parches[0][2]["stock"], 21.0)
        self.assertEqual(posts[0]["quantity"], 28.5, "la entrada debe cubrir el hoyo")

    def test_solo_repone_los_que_lo_necesitan(self):
        (repuestos, _), parches, posts = correr([
            insumo("cafe", 1.0), insumo("leche", 19.0), insumo("huevo", 0.5)])
        self.assertEqual(repuestos, 2)
        self.assertEqual({p[1].split("ingredient_id=eq.")[1] for p in parches},
                         {"cafe", "huevo"})
        self.assertEqual(len(posts), 2)

    def test_una_segunda_corrida_seguida_no_repone_otra_vez(self):
        # Idempotencia: tras reponer, el stock quedó en el objetivo, muy por encima del
        # punto. Correrlo de nuevo no debe escribir nada.
        filas = [insumo("cafe", 1.0)]
        (_, _), parches, _ = correr(filas)
        ya_repuesto = [insumo("cafe", parches[0][2]["stock"])]
        (repuestos, _), parches2, posts2 = correr(ya_repuesto)
        self.assertEqual((repuestos, parches2, posts2), (0, [], []))


# ── 2 y 3. El movimiento y su signo ──────────────────────────────────────────

class DejaRastro(unittest.TestCase):
    def test_cada_reposicion_escribe_su_movimiento(self):
        (_, _), parches, posts = correr([insumo("cafe", 1.0)])
        self.assertEqual(len(posts), len(parches), "saldo movido sin fila que lo explique")

    def test_el_movimiento_dice_de_donde_viene(self):
        _, _, posts = correr([insumo("cafe", 1.0)])
        m = posts[0]
        self.assertEqual(m["movement_type"], "restock")
        self.assertEqual(m["actor"], "reposicion_demo")
        self.assertEqual(m["client_id"], "demo")
        self.assertEqual(m["ingredient_id"], "cafe")
        self.assertIn("1.000", m["notes"])
        self.assertIn("21.000", m["notes"])

    def test_la_entrada_es_positiva(self):
        # El consumo se escribe negativo (`-v_ing_delta`). Que la entrada sea positiva
        # deja que el signo distinga entrada de salida sin mirar el tipo.
        _, _, posts = correr([insumo("cafe", 1.0), insumo("huevo", -2.0)])
        for m in posts:
            self.assertGreater(m["quantity"], 0, m)

    def test_la_entrada_es_exactamente_el_faltante(self):
        _, _, posts = correr([insumo("cafe", 6.25, punto=10.0, objetivo=40.0)])
        self.assertEqual(posts[0]["quantity"], 33.75)

    def test_el_saldo_queda_en_el_objetivo_no_sumado_encima(self):
        # `reorder_quantity` es el NIVEL objetivo (así lo sembró el seeder: mismo valor
        # que el stock inicial), no una cantidad que se acumula.
        _, parches, _ = correr([insumo("cafe", 1.0)])
        self.assertEqual(parches[0][2]["stock"], 21.0)
        self.assertIn("last_restock", parches[0][2])


# ── 4. Lo que no se sabe, no se inventa ──────────────────────────────────────

class NoAdivina(unittest.TestCase):
    def test_sin_nivel_declarado_no_se_repone(self):
        (repuestos, _), parches, posts = correr([insumo("cafe", 0.0, objetivo=0.0)])
        self.assertEqual((repuestos, parches, posts), (0, [], []))

    def test_un_inventario_vacio_truena_en_vez_de_pasar_en_verde(self):
        # Cero filas no es "nada que reponer": es que el tenant no tiene inventario, y
        # eso hay que decirlo.
        with self.assertRaises(RuntimeError) as ctx:
            correr([])
        self.assertIn("pos_inventory", str(ctx.exception))


# ── 5. Lista blanca ──────────────────────────────────────────────────────────

class SoloTenantsDePrueba(unittest.TestCase):
    def test_amalay_no_esta_en_la_lista(self):
        self.assertNotIn("amalay", rd.TENANTS_PERMITIDOS)

    def test_main_rechaza_un_tenant_real(self):
        with silencio(), mock.patch.dict("os.environ", {"CLIENT_ID": "amalay"}):
            self.assertEqual(rd.main(), 1)

    def test_main_no_escribe_nada_si_rechaza(self):
        with silencio(), mock.patch.dict("os.environ", {"CLIENT_ID": "amalay"}), \
                mock.patch.object(rd, "sb_get") as g, \
                mock.patch.object(rd, "sb_patch") as p, \
                mock.patch.object(rd, "sb_post") as o:
            rd.main()
        g.assert_not_called(); p.assert_not_called(); o.assert_not_called()


# ── 6. El cruce sigue siendo posible ─────────────────────────────────────────

class ElCruceSobrevive(unittest.TestCase):
    def test_la_entrada_no_se_confunde_con_consumo(self):
        # Hasta hoy `demo` sólo tenía salidas, así que sumar abs(quantity) de TODO daba
        # el consumo. Con entradas eso deja de ser cierto, y el filtro por tipo es lo
        # que salva el cruce contra ops_consumo.
        _, _, posts = correr([insumo("cafe", 1.0)])
        self.assertNotIn(posts[0]["movement_type"], rd.TIPOS_DE_CONSUMO)

    def test_los_tipos_de_consumo_son_los_que_escribe_el_reconciliador(self):
        self.assertEqual(set(rd.TIPOS_DE_CONSUMO),
                         {"recipe_deduction", "recipe_reversal"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
