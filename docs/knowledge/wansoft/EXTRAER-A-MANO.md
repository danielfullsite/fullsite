# Extraer datos de Wansoft a mano

> Verificado el 2026-09-09 extrayendo 61 días de AMALAY Plaza Duendes.

Wansoft puso **Cloudflare Turnstile** en el login. Ningún scraper se autentica solo —
`requests`, Playwright headless y Playwright headed fallan igual. Por eso no hay cron que
arregle esto: **la extracción siempre la inicia una persona.**

Este documento es el procedimiento. Toma unos 5 minutos.

---

## 1. Entrar

Abrir <https://www.wansoft.net/Wansoft.Web/> en Chrome y entrar normal, a mano.

## 2. Ir al reporte que sirve histórico

<https://www.wansoft.net/Wansoft.Web/Reports/ConsolidatedSalesMasterReport>
("Reportes → Ingresos → Ventas por sucursal")

Ahí está el `__RequestVerificationToken` que necesitan las llamadas.

## 3. Pegar el extractor en la consola (F12 → Console)

```js
const tok = (document.querySelector('input[name="__RequestVerificationToken"]') || {}).value || '';
const num = s => { const v = parseFloat(String(s).replace(/[$,\s%]/g, '')); return isNaN(v) ? 0 : v; };

const P = async (path, body) => {
  const p = new URLSearchParams(body);
  if (tok) p.append('__RequestVerificationToken', tok);
  const r = await fetch('/Wansoft.Web/' + path, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
    body: p.toString(),
  });
  return await r.text();
};

const filas = h => {
  const d = new DOMParser().parseFromString(h, 'text/html');
  return [...d.querySelectorAll('.rowReport')].map(r => [...r.querySelectorAll('div')].map(c => c.textContent.trim()));
};

const dia = async (iso, sub) => {
  const b = { subsidiaryId: sub, startDate: iso, endDate: iso };   // ISO. Ver la advertencia.
  const cons = JSON.parse(await P('Reports/GetConsolidatedSales', b));
  const R = async p => filas(await P('Reports/' + p, b));
  const [usr, grp, sau, tip, pag, tps] = await Promise.all(
    ['SalesByUser', 'SalesByGroup', 'SalesBySaucer', 'SalesByTypeOfOrder', 'SalesByPaymentType', 'TipByUser'].map(R));
  const t = n => tip.find(x => x[0] === n) || [];
  const T = r => ({ n: r[0], tp: num(r[1]), per: num(r[2]), cta: num(r[3]), t: num(r[5]) });
  const R_ = T(t('Restaurant').length ? t('Restaurant') : ['', 0, 0, 0, 0, 0]);
  const LL = T(t('Para llevar').length ? t('Para llevar') : ['', 0, 0, 0, 0, 0]);
  const sum = a => Math.round(a.reduce((s, x) => s + x.t, 0) * 100) / 100;
  const pagos = pag.map(r => ({ nombre: r[0], total: num(r[1]) }));
  const props = tps.map(r => ({ nombre: r[0], total: num(r[1]) }));
  return {
    fecha: iso,
    ventas_dia: cons.TotalSales,
    ventas_brutas: Math.round((cons.TotalSales + cons.TotalDiscount) * 100) / 100,
    descuentos: cons.TotalDiscount, devoluciones: cons.TotalCancelSales,
    efectivo: sum(pagos.filter(x => /efec/i.test(x.nombre)).map(x => ({ t: x.total }))),
    tarjeta: sum(pagos.filter(x => /tarjeta/i.test(x.nombre)).map(x => ({ t: x.total }))),
    tickets_count: tip.reduce((s, r) => s + num(r[3]), 0),
    mesas_atendidas: R_.cta, ordenes_llevar: LL.cta,
    personas_restaurant: R_.per, cuentas_restaurant: R_.cta,
    ticket_promedio_restaurant: R_.tp,
    propinas_total: sum(props.map(x => ({ t: x.total }))),
    chilaquiles_total: sum(grp.filter(r => /CHILAQUILES/i.test(r[0])).map(r => ({ t: num(r[3]) }))),
    half_half_total: sum(sau.filter(r => /HALF/i.test(r[0])).map(r => ({ t: num(r[3]) }))),
    meseros: usr.map(r => ({ nombre: r[0], total: num(r[3]) })),
    platillos_top: sau.slice(0, 15).map(r => ({ nombre: r[0], cantidad: num(r[1]), total: num(r[3]) })),
    ventas_por_grupo: grp.map(r => ({ nombre: r[0], total: num(r[3]) })),
    pago_metodos: pagos, propinas_meseros: props,
  };
};

window.wsRango = async (desde, hasta, sub = '6043') => {
  const out = [], d = new Date(desde + 'T12:00:00'), fin = new Date(hasta + 'T12:00:00');
  while (d <= fin) {
    const iso = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    try { out.push(await dia(iso, sub)); } catch (e) { out.push({ fecha: iso, error: String(e).slice(0, 80) }); }
    d.setDate(d.getDate() + 1);
    await new Promise(r => setTimeout(r, 80));
  }
  console.log(out.length + ' días, ' + out.filter(x => x.error).length + ' con error');
  return out;
};

window.wsBajar = (datos, nombre) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(datos)], { type: 'application/json' }));
  a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
};
```

## 4. Extraer y bajar

```js
const datos = await wsRango('2026-07-11', '2026-09-08');   // no incluir el día en curso
wsBajar(datos, 'amalay-wansoft-2026-07-11_2026-09-08.json');
```

Van ~25 días por tanda para no aburrir al navegador. Si son muchos, partirlo y concatenar.

## 5. Cargar

Poner el archivo en `data/backfill/` y correr:

```bash
gh workflow run wansoft-cargar-extracto.yml -f archivo=data/backfill/<archivo>.json -f dry_run=true
```

Leer el resumen, y si cuadra, repetir con `dry_run=false`. El cargador escribe
`wansoft_daily` **y** `ops_daily` — las dos, porque `ops_daily_history` (el contrato que
leen todos los agentes) une `ops_daily`, no `wansoft_daily`.

---

## ⚠️ Las fechas van en ISO. Siempre.

**Wansoft interpreta las fechas con barras como `DD/MM/YYYY`.** Medido contra el portal:

| Se manda | Wansoft entiende | Total |
|---|---|---|
| `09/08/2026` | **9 de agosto** | $140,703.50 |
| `2026-09-08` | 8 de septiembre | $53,458.50 |
| `09/05/2026` | **9 de mayo** | $118,315.60 |

Y cuando el "mes" queda entre 13 y 31 **no devuelve error**: regresa un agregado fijo
—`$640,602.40` el 2026-09-09— o sea datos plausibles de otro periodo. Si ese número
aparece en un extracto, está corrupto: alguien mandó `MM/DD/YYYY`.

`test_wansoft_cargar_extracto.py` tiene una prueba que lo caza.

---

## Los 22 endpoints del reporte

Todos aceptan `subsidiaryId`, `startDate`, `endDate` (ISO) y devuelven HTML con `.rowReport`,
salvo `GetConsolidatedSales` que devuelve JSON.

| Endpoint | Columnas | Alimenta |
|---|---|---|
| `GetConsolidatedSales` | JSON | totales del día |
| `SalesByUser` | nombre, subtotal, iva, total, % | `meseros` |
| `SalesByGroup` | grupo, subtotal, iva, total, % | `ventas_por_grupo` |
| `SalesBySaucer` | platillo, cant, subtotal, total, % | `platillos_top` |
| `SalesByTypeOfOrder` | tipo, tkt prom, personas, cuentas, subtotal, total | mesas, personas, llevar |
| `SalesByPaymentType` | método, total, % | `pago_metodos`, efectivo, tarjeta |
| `TipByUser` | mesero, total, % | `propinas_total` |
| `SalesByHours` | — | `wansoft_hourly` *(sin usar)* |
| `PersonsByDay` / `PersonsByHour` / `PersonsByDayName` | — | `wansoft_persons_hourly` *(sin usar)* |
| `SalesByArea` / `SalesByTerminal` / `SalesByGroupType` / `SalesByModifiers` | — | *(sin usar)* |
| `DiscountsDetail` / `CourtesiesDetail` / `CancelSalesDetail` / `SaleNullificationDetail` | — | auditoría *(sin usar)* |
| `Promotions` / `ChargePaymentMethod` / `MegaPointsReport` | — | *(sin usar)* |

Los marcados *(sin usar)* cubren tablas que hoy están vacías o paradas —
`wansoft_hourly` (48.8% de cobertura), `wansoft_tips`, `wansoft_persons_hourly`,
`wansoft_shrinkage` (0 filas). Están mapeados y disponibles cuando se quieran.

## Sucursales

| id | nombre |
|---|---|
| `6043` | 01 - Café Amalay - Plaza Duendes |
| `13184` | Amalay - Arboleda |

Hoy sólo se carga `6043`. Antes de cargar `13184` hay que quitar
`wansoft_daily_fecha_key` —un índice único sobre `fecha` **sola**— que hace imposible
guardar dos sucursales el mismo día. La PK `(client_slug, fecha, report_type)` ya hace
ese trabajo bien.
