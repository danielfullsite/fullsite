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


# ── UNA EXCEPCION, RAZONADA Y ACOTADA A FUNCIONES ───────────────────────────
#
# La regla de arriba es sobre DATOS: un `grant select` a `anon` sobre una tabla o una
# vista es publicar, porque la autorizacion la lleva el rol.
#
# `grant execute on function` no es lo mismo cuando la funcion AUTENTICA A SU LLAMANTE.
# `apply_pos_caja_event` es `SECURITY DEFINER` y lo primero que hace es exigir una
# credencial por stream y compararla contra su hash:
#
#     if p_credential is null or length(p_credential) < 32 ... raise 'SYNC_UNAUTHORIZED'
#     if stream.credential_hash <> encode(sha256(convert_to(p_credential,'UTF8')),'hex')
#        then raise 'SYNC_UNAUTHORIZED'
#
# Quien la llama es Pedro, desde la terminal del restaurante, con la llave publica mas
# esa credencial (`business-outbox.js`). La alternativa —quitarle el `anon`— obliga a
# poner una `service_role` EN CADA TERMINAL, y esa llave se salta el RLS del proyecto
# entero. Exponer una funcion que valida su propia credencial es estrictamente mas
# seguro que repartir la llave maestra.
#
# LA EXCEPCION NO AFLOJA LA GUARDA. Sigue siendo culpable:
#   · cualquier grant a `anon` sobre tablas o vistas — la fuga de #104 y #373;
#   · cualquier grant execute sobre una funcion QUE NO ESTE EN ESTA LISTA.
#
# Para agregar una funcion aqui hay que leer su cuerpo y demostrar que rechaza a quien
# no trae credencial. Si no, no entra.
FUNCIONES_QUE_AUTENTICAN_SOLAS = {
    "apply_pos_caja_event",
}

RE_GRANT_EXECUTE_FUNCION = re.compile(
    r"\bgrant\s+execute\s+on\s+function\s+(?:public\.)?(?P<fn>\w+)", re.I)


def grants_a_anon():
    """(archivo, sentencia) por cada GRANT que incluya el rol `anon`."""
    hallazgos = []
    for nombre, cuerpo in _cuerpos():
        for m in RE_GRANT.finditer(cuerpo):
            roles = m.group("roles")
            if not re.search(r"(^|[\s,(])anon([\s,);]|$)", roles, re.I):
                continue
            fn = RE_GRANT_EXECUTE_FUNCION.match(m.group(0).strip())
            if fn and fn.group("fn").lower() in FUNCIONES_QUE_AUTENTICAN_SOLAS:
                continue
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




class LaExcepcionDeFuncionesEsAcotada(unittest.TestCase):
    """La excepcion de `FUNCIONES_QUE_AUTENTICAN_SOLAS` existe porque una funcion que
    valida su propia credencial no es una tabla abierta. Estas pruebas fijan que no se
    pueda ensanchar sin querer: si la excepcion empieza a tapar un grant de datos,
    volvemos a #104 y #373 con la guarda puesta y en verde."""

    def _hallazgos(self, sql):
        # Se ejerce la MISMA logica de `grants_a_anon` sobre un cuerpo de mentira.
        salida = []
        for m in RE_GRANT.finditer(sin_comentarios(sql)):
            if not re.search(r"(^|[\s,(])anon([\s,);]|$)", m.group("roles"), re.I):
                continue
            fn = RE_GRANT_EXECUTE_FUNCION.match(m.group(0).strip())
            if fn and fn.group("fn").lower() in FUNCIONES_QUE_AUTENTICAN_SOLAS:
                continue
            salida.append(" ".join(m.group(0).split()))
        return salida

    def test_un_grant_de_DATOS_sigue_siendo_culpable(self):
        # Lo que causo la fuga. Que la excepcion exista no puede cambiar esto.
        self.assertEqual(len(self._hallazgos(
            "grant select on public.ops_consumo to anon, authenticated;")), 1)

    def test_una_funcion_que_NO_esta_en_la_lista_es_culpable(self):
        self.assertEqual(len(self._hallazgos(
            "grant execute on function public.otra_cosa(uuid) to anon;")), 1)

    def test_la_funcion_de_la_lista_pasa(self):
        self.assertEqual(self._hallazgos(
            "grant execute on function public.apply_pos_caja_event(uuid, text, text, "
            "text, jsonb) to anon, authenticated, service_role;"), [])

    def test_un_grant_de_TABLA_con_el_nombre_de_la_funcion_NO_pasa(self):
        # El colador obvio: una tabla que se llame igual que la funcion permitida.
        # La excepcion exige literalmente `grant execute on function`.
        self.assertEqual(len(self._hallazgos(
            "grant select on public.apply_pos_caja_event to anon;")), 1)

    def test_la_lista_es_corta_y_deliberada(self):
        # Un piso al reves: si esto crece, alguien debe justificarlo por escrito.
        # Cada entrada exige haber leido el cuerpo de la funcion y demostrado que
        # rechaza a quien no trae credencial.
        self.assertLessEqual(len(FUNCIONES_QUE_AUTENTICAN_SOLAS), 3)

    def test_la_funcion_permitida_de_verdad_exige_credencial(self):
        # La excepcion vale lo que valga esta comprobacion: si manana alguien le quita
        # la validacion a la funcion, la excepcion se vuelve una puerta abierta y ESTA
        # prueba es la que lo dice.
        for nombre, cuerpo in _cuerpos():
            if "apply_pos_caja_event" not in cuerpo:
                continue
            if "create or replace function public.apply_pos_caja_event" not in cuerpo.lower():
                continue
            self.assertRegex(
                cuerpo, r"(?is)p_credential\s+is\s+null.*?raise\s+exception\s+'SYNC_UNAUTHORIZED'",
                f"{nombre}: la funcion permitida dejo de rechazar una credencial vacia")
            self.assertRegex(
                cuerpo, r"(?is)credential_hash\s*<>\s*encode\(\s*sha256",
                f"{nombre}: la funcion permitida dejo de comparar el hash de la credencial")
            return
        self.fail("no se encontro la definicion de apply_pos_caja_event que justifica la excepcion")


if __name__ == "__main__":
    unittest.main(verbosity=2)
