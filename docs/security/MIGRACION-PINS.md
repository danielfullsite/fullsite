# Migración de PINs del POS — quién falta

> El código de `/api/pos/pin` acepta PINs de 4 a 10 dígitos y lo declara transitorio:
> *"existing staff may still have 4–8 digit PINs while each person is migrated to a unique
> 10-digit emergency PIN."* Este documento sirve para saber cuánto falta de esa migración.
>
> Levantado el 2026-08-26 al verificar el fix de `POS_FALLBACK_PIN`.

## Por qué importa

Un PIN de 4 dígitos tiene 10,000 combinaciones. El throttle de `pin-throttle.ts` va por
*(restaurante, IP)*, así que protege bien contra alguien probándolas todas — **no contra alguien
probando las diez obvias**: `1234`, `0000`, `1111`, `2222`, `1122`, `4321`…

Y hay una consecuencia que no es de acceso sino de **prueba**: la bitácora de fraude registra
quién autorizó cada cancelación y cada corte. Si el PIN de un gerente es adivinable, esa firma
deja de probar nada. El registro sigue existiendo; lo que se pierde es que sirva de evidencia.

Por eso el orden de migración no es alfabético: es por **quién mueve dinero**.

## La consulta

Nunca muestra un PIN. Sólo cuántos dígitos tiene, si ya migró, y si es uno de los obvios.

```sql
SELECT
  s.name AS persona,
  s.role AS rol,
  length(s.pin) AS digitos,
  CASE WHEN length(s.pin) >= 10 THEN 'migrado' ELSE 'PENDIENTE' END AS estado,
  CASE WHEN s.pin IN ('1234','0000','1111','2222','1122','4321','1212','9999','1010','1234567890')
       OR s.pin ~ '^(\d)\1+$'        -- todos los dígitos iguales
       THEN 'SI' ELSE '' END AS pin_obvio
FROM public.pos_staff s
WHERE s.client_id = 'amalay' AND s.active = true
ORDER BY
  CASE s.role WHEN 'admin' THEN 1 WHEN 'gerente' THEN 2 WHEN 'cajero' THEN 3
              WHEN 'capitan' THEN 4 WHEN 'barra' THEN 5 WHEN 'mesero' THEN 6 ELSE 7 END,
  (length(s.pin) >= 10),
  s.name;
```

Para otro restaurante, cambiar `client_id`. Para el avance en una línea:

```sql
SELECT
  count(*) FILTER (WHERE length(pin) >= 10) AS migrados,
  count(*) AS total,
  count(*) FILTER (WHERE length(pin) < 10 AND role IN ('admin','gerente','cajero')) AS pendientes_que_mueven_dinero
FROM public.pos_staff
WHERE client_id = 'amalay' AND active = true;
```

## Línea base — 2026-08-26

**0 de 40 migrados.** Todos con 4 dígitos.

| Rol | Personas | Prioridad |
|---|---|---|
| admin | 1 | 🔴 **Primero** — rol máximo, y es el único con PIN obvio |
| gerente | 5 | 🔴 Autorizan cancelaciones y descuentos |
| cajero | 4 | 🔴 Hacen cortes y mueven efectivo |
| barra | 2 | 🟡 |
| mesero | 14 | 🟢 Su rol no mueve dinero |
| cocina | 14 | 🟢 |

**10 personas mueven dinero. Ésas son las que importan**, no las 40.

## Cómo se cambia

Desde el POS, en la pantalla de personal. **No se cambia por SQL:** el PIN es dato de una persona
real y el cambio debe quedar con su bitácora normal. Este documento es para *medir* la migración,
no para ejecutarla.

## Definición de terminado

`pendientes_que_mueven_dinero = 0`. El resto puede migrar al ritmo de la operación.
