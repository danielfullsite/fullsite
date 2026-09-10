#!/usr/bin/env python3
"""Pruebas de `supabase/migrations/` — sin red.

POR QUE EXISTEN
El 2026-09-09, a las 17:16 UTC, se aplico desde `main` una migracion que terminaba en

    grant select on public.ops_consumo to anon, authenticated, service_role;

y creaba la vista SIN `security_invoker`. Eso reabrio, media hora despues de haberse
cerrado, una fuga que publicaba 148 filas de 3 restaurantes a cualquiera con la llave
publica del proyecto. El PR #373 ya traia el arreglo del archivo, pero seguia sin
mergear: el archivo con el hueco todavia vivia en `main`, y de ahi se aplico.

LAS DOS MITADES, Y POR QUE NINGUNA BASTA SOLA

  · `anon` es el rol de la LLAVE PUBLICA. Otorgarle SELECT es publicar.
  · Las tablas base SI tienen RLS, pero las vistas las posee `postgres`, que tiene
    `rolbypassrls = true`. Sin `security_invoker = on` la vista corre como su dueno y
    el RLS NO aplica — asi que una vista abierta expone TODOS los tenants, no uno.

Es la misma propiedad que cerro #104 (un usuario de boruca veia 1,415 dias de 5
restaurantes) y la que volvio en #373. Estas pruebas la fijan en el unico lugar donde
se puede atrapar antes de produccion: el archivo, en cada PR.

QUE NO CUBREN
Sólo leen los archivos de `supabase/migrations/`. Un `grant` hecho a mano en el SQL
Editor no pasa por aqui — para eso esta el barrido en produccion que documenta
`docs/` y que conviene correr tras cualquier cambio de permisos.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

MIGRACIONES = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

# Pisos anti-vacio. Son suelos, no objetivos: si se agregan migraciones deben subir,
# nunca bajar en silencio. Medidos al 2026-09-09.
MINIMO_ARCHIVOS = 25
MINIMO_VISTAS = 8


def sin_comentarios(texto: str) -> str:
    """Quita comentarios SQL para no confundir documentacion con codigo.

    Importa de verdad: los archivos arreglados EXPLICAN el bug citando la linea mala
    (`--   grant select on public.ops_consumo to anon, ...`). Un escaneo que mirara el
    texto crudo marcaria como culpables justo a los archivos ya corregidos.
    """
    texto = re.sub(r"/\*.*?\*/", " ", texto, flags=re.S)
    return "\n".join(linea.split("--")[0] for linea in texto.splitlines())


def _archivos():
    return sorted(MIGRACIONES.glob("*.sql"))


def _cuerpos():
    return [(f.name, sin_comentarios(f.read_text(encoding="utf-8", errors="replace")))
            for f in _archivos()]


# `grant ... to <roles>` donde `anon` aparece en la lista de roles. Se acota la lista
# de roles hasta el `;` para no barrer medio archivo.
RE_GRANT = re.compile(r"\bgrant\b(?P<que>[^;]*?)\bto\b(?P<roles>[^;]*);", re.I | re.S)
RE_CREATE_VIEW = re.compile(
    r"\bcreate\s+(?:or\s+replace\s+)?view\s+(?P<nombre>[\w.]+)(?P<cola>.{0,160})",
    re.I | re.S)


def grants_a_anon():
    """(archivo, sentencia) por cada GRANT que incluya el rol `anon`."""
    hallazgos = []
    for nombre, cuerpo in _cuerpos():
        for m in RE_GRANT.finditer(cuerpo):
            roles = m.group("roles")
            if re.search(r"(^|[\s,(])anon([\s,);]|$)", roles, re.I):
                sentencia = " ".join(m.group(0).split())[:160]
                hallazgos.append((nombre, sentencia))
    return hallazgos


def vistas_declaradas():
    """(archivo, nombre_vista, trae_security_invoker_en_el_create)."""
    vistas = []
    for nombre, cuerpo in _cuerpos():
        for m in RE_CREATE_VIEW.finditer(cuerpo):
            con = bool(re.search(r"security_invoker\s*=\s*on", m.group("cola"), re.I))
            vistas.append((nombre, m.group("nombre").split(".")[-1], con))
    return vistas


class NingunaMigracionOtorgaAAnon(unittest.TestCase):
    """`anon` es la llave publica. Un GRANT a `anon` es una publicacion."""

    def test_ningun_grant_incluye_anon(self):
        culpables = [f"{arch}: {sent}" for arch, sent in grants_a_anon()]
        self.assertEqual(
            culpables, [],
            "Estas migraciones otorgan permisos al rol `anon`, que es el de la LLAVE "
            "PUBLICA del proyecto. Si la vista ademas corre sin `security_invoker`, el "
            "RLS no aplica y se publican los datos de TODOS los tenants.\n  "
            + "\n  ".join(culpables))

    def test_el_escaneo_no_pasa_en_vacio(self):
        # Sin esto, mover la carpeta o cambiar la extension dejaria la prueba de arriba
        # trivialmente verde: cero archivos, cero culpables, aprobado sin revisar nada.
        self.assertGreaterEqual(
            len(_archivos()), MINIMO_ARCHIVOS,
            f"Solo se hallaron {len(_archivos())} migraciones y se esperaban al menos "
            f"{MINIMO_ARCHIVOS}. O cambio la ruta ({MIGRACIONES}), o se borraron.")


class TodaVistaTerminaConSecurityInvoker(unittest.TestCase):
    """La otra mitad: sin `security_invoker = on` la vista corre como `postgres`
    (`rolbypassrls = true`) y el RLS de las tablas base no aplica."""

    def test_toda_vista_queda_con_security_invoker(self):
        # Se admite que el `create` no lo traiga si alguna migracion se lo pone despues
        # con `alter view ... set (...)`. Asi quedaron ops_daily_desde_pos, _history y
        # _live: nacieron sin la opcion el 2026-08-26 y se las puso una posterior.
        corpus = "\n".join(c for _, c in _cuerpos())
        faltantes = []
        for arch, vista, con_create in vistas_declaradas():
            if con_create:
                continue
            puesta_despues = re.search(
                r"alter\s+view\s+(?:public\.)?%s\s+set\s*\([^)]*security_invoker\s*=\s*on"
                % re.escape(vista), corpus, re.I)
            if not puesta_despues:
                faltantes.append(f"{arch}: {vista}")
        self.assertEqual(
            faltantes, [],
            "Estas vistas nunca quedan con `security_invoker = on`. Las posee "
            "`postgres` (rolbypassrls), asi que corren saltandose el RLS de sus tablas "
            "base y devuelven filas de todos los tenants.\n  " + "\n  ".join(faltantes))

    def test_el_escaneo_no_pasa_en_vacio(self):
        vistas = vistas_declaradas()
        self.assertGreaterEqual(
            len(vistas), MINIMO_VISTAS,
            f"Solo se hallaron {len(vistas)} vistas y se esperaban al menos "
            f"{MINIMO_VISTAS}. Probablemente el patron dejo de reconocer `create view`.")


class ElEscaneoDistingueCodigoDeComentario(unittest.TestCase):
    """Las pruebas de arriba valen lo que valga `sin_comentarios`. Si marcara los
    comentarios como codigo, los archivos YA corregidos —que citan la linea mala para
    explicar el bug— saldrian como culpables y la senal se volveria ruido."""

    def test_un_grant_comentado_no_cuenta(self):
        self.assertNotIn("grant", sin_comentarios(
            "--   grant select on public.ops_consumo to anon, authenticated;").lower())

    def test_un_bloque_comentado_no_cuenta(self):
        self.assertNotIn("grant", sin_comentarios(
            "/* grant select on public.x to anon; */").lower())

    def test_un_grant_de_verdad_SI_cuenta(self):
        self.assertIn("grant", sin_comentarios(
            "grant select on public.x to anon;  -- ojo").lower())

    def test_el_detector_atrapa_la_linea_exacta_que_causo_la_fuga(self):
        # La sentencia real de 20260909090000_ops_consumo.sql antes de #373.
        cuerpo = sin_comentarios(
            "grant select on public.ops_consumo to anon, authenticated, service_role;")
        m = RE_GRANT.search(cuerpo)
        self.assertIsNotNone(m, "el patron ya no reconoce un GRANT")
        self.assertRegex(m.group("roles"), r"(?i)(^|[\s,(])anon([\s,);]|$)")

    def test_un_grant_sin_anon_NO_se_marca(self):
        # `authenticated` y `service_role` son legitimos; marcarlos volveria inutil
        # la prueba por exceso de ruido.
        cuerpo = sin_comentarios(
            "grant select on public.x to authenticated, service_role;")
        m = RE_GRANT.search(cuerpo)
        self.assertNotRegex(m.group("roles"), r"(?i)(^|[\s,(])anon([\s,);]|$)")

    def test_revoke_de_anon_NO_se_confunde_con_grant(self):
        # Los archivos corregidos hacen `revoke all ... from public, anon`. Marcarlos
        # seria exactamente al reves de lo que se quiere.
        self.assertIsNone(RE_GRANT.search(sin_comentarios(
            "revoke all on public.ops_consumo from public, anon;")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
