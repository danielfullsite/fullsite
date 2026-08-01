# Unit Economics Deep Analysis — Fullsite

Fecha: 2026-07-04
Tipo de cambio usado: $17.45 MXN/USD (Banxico julio 2026)

---

## NOTA SOBRE PRECIO

El precio en PRICING-FINAL.md es $1,999 MXN/mes. En esta conversacion se mencionaron $1,499 MXN/mes. Este analisis modela AMBOS escenarios donde es relevante, pero usa $1,999 como precio base (el precio publicado actual).

---

## 1. CAC Real (Costo de Adquisicion por Restaurante)

No es solo la comision de Andres. Es TODO lo que cuesta convertir un prospecto en cliente pagando.

### Costos directos por deal cerrado

| Concepto | Costo estimado | Fuente |
|---|---|---|
| Comision unica Andres (1 sucursal, solo software) | $5,000 MXN | Propuesta Andres |
| Bono implementacion Eduardo | $3,000-$5,000 MXN | PRICING-FINAL.md |
| Tiempo de Daniel en demo (2-3 hrs a $500/hr imputado) | $1,000-$1,500 MXN | Ver calculo abajo |
| Transporte/gasolina visita (Monterrey) | $200-$500 MXN | Estimacion local |
| Tiempo Eduardo implementando (8 hrs a $250/hr) | $2,000 MXN | Incluido en bono |
| **Total CAC directo** | **$9,200-$12,000 MXN** | |
| **Total CAC directo en USD** | **$527-$688 USD** | |

### Calculo del costo imputado de Daniel

Daniel es CEO, CTO, soporte, y a veces vendedor. Su costo de oportunidad es real aunque no se pague salario. Un ingeniero de software senior en Monterrey gana $24,000-$34,000 MXN/mes (fuente: Glassdoor, Indeed, talent.com 2026). Usando $30,000 MXN/mes como base conservadora:

- $30,000 / 160 hrs = $187.50 MXN/hr (costo base)
- Pero Daniel es el fundador-ingeniero unico. Su hora real vale mas porque es insustituible. Factor 2x-3x: **$375-$562 MXN/hr**
- Usaremos **$500 MXN/hr** como costo imputado

### Comparacion con benchmarks

| Compania/Segmento | CAC | Fuente |
|---|---|---|
| **Fullsite (estimado)** | **$527-$688 USD** | Calculo arriba |
| Toast (calculado: S&M $470M / 28K locations 2024) | **~$16,786 USD** | Toast 10-K 2024 |
| SaaS SMB promedio | $300-$1,500 USD | Userpilot 2026 |
| SaaS con venta directa SMB | $500-$2,000 USD | Optifai 2026 |

Conclusion: El CAC de Fullsite es **extremadamente bajo** comparado con Toast (~30x menor) y competitivo con SaaS SMB promedio. Esto es porque:
1. Sin marketing pagado
2. Venta door-to-door sin salario base
3. Implementacion rapida (8 hrs vs dias)
4. Sin equipo de SDR/BDR/AE costoso

Pero ojo: esto es pre-escala. El CAC sube cuando necesitas salarios base, marketing pagado, y procesos formales.

---

## 2. Costo Real de Servir un Restaurante

### Costos mensuales por restaurante

| Concepto | Costo/mes | Escala | Notas |
|---|---|---|---|
| API Claude (IA) | $200 MXN (~$11.50 USD) | Lineal | Sube con uso, pero predecible |
| Comision recurrente Andres (10%) | $200 MXN | Lineal | Perpetua mientras el cliente pague |
| Hosting (Vercel/Supabase) | ~$50 MXN repartido | Sublineal | Costo fijo que se diluye |
| Soporte Daniel (estimado 2 hrs/mes iniciales) | $1,000 MXN imputado | Problema | Ver seccion 6 |
| **Total costo servir (sin imputar tiempo Daniel)** | **$450 MXN/mes** | | |
| **Total costo servir (con tiempo Daniel)** | **$1,450 MXN/mes** | | |

### Margen real por restaurante

| Escenario | Revenue | Costo servir | Margen | Margen % |
|---|---|---|---|---|
| Sin imputar tiempo Daniel | $1,999 | $450 | $1,549 | 77.5% |
| Con tiempo Daniel (2 hrs/mes) | $1,999 | $1,450 | $549 | 27.5% |
| Si precio fuera $1,499 (sin Daniel) | $1,499 | $450 | $1,049 | 70.0% |
| Si precio fuera $1,499 (con Daniel) | $1,499 | $1,450 | $49 | 3.3% |

### Como escala el costo de servir

| Restaurantes | API Claude | Comision Andres | Hosting | Soporte Daniel | Total costo | Revenue | Margen |
|---|---|---|---|---|---|---|---|
| 5 | $1,000 | $1,000 | $500 | $5,000 | $7,500 | $9,995 | $2,495 (25%) |
| 10 | $2,000 | $2,000 | $800 | $7,000 | $11,800 | $19,990 | $8,190 (41%) |
| 25 | $5,000 | $5,000 | $1,500 | $10,000 | $21,500 | $49,975 | $28,475 (57%) |
| 50 | $10,000 | $10,000 | $3,000 | $15,000 | $38,000 | $99,950 | $61,950 (62%) |
| 100 | $20,000 | $20,000 | $5,000 | $25,000 | $70,000 | $199,900 | $129,900 (65%) |

Nota: El soporte de Daniel escala sublinealmente despues de ~20 restaurantes porque:
- Los problemas se repiten y se documentan
- El soporte IA 24/7 absorbe preguntas tier-1
- Se necesita contratar soporte humano ($8,000-$12,000 MXN/mes) alrededor de 15-20 restaurantes

Benchmark SaaS: Margen bruto mediano es 74% (Benchmarkit 2024). Fullsite llega a 65% con 100 restaurantes, pero sin imputar el costo completo de Daniel como ingeniero. Con un equipo real, el margen baja.

---

## 3. LTV (Lifetime Value) Real

### Tasa de churn esperada para restaurantes en Mexico

| Factor | Dato | Fuente |
|---|---|---|
| Tasa cierre restaurantes Mexico, primer ano | 60% | Cooking Depot, Posist |
| Tasa cierre restaurantes Mexico, primeros 5 anos | 70-80% | Cooking Depot |
| Churn SaaS SMB (mensual) | 2-4% | NetSuite, Churnkey 2024 |
| Churn SaaS SMB (anual) | 7.5% | CustomerGauge 2025 |
| Churn por cierre de negocio (restaurantes) | ~12-15% anual | Estimado: 60% en 5 anos |
| Churn voluntario (cambian de software) | ~5-8% anual | Benchmark SaaS SMB |

Churn total estimado para Fullsite: **15-20% anual** (combinando cierre de negocio + churn voluntario)

- Conservador: 20% anual = 1.67% mensual
- Base: 17% anual = 1.42% mensual
- Optimista: 12% anual = 1.0% mensual

### Vida util esperada del cliente

| Escenario | Churn anual | Vida util promedio | Fuente formula |
|---|---|---|---|
| Conservador | 20% | 5 anos (1/0.20) | Estandar SaaS |
| Base | 17% | 5.9 anos | |
| Optimista | 12% | 8.3 anos | |

Pero: la formula 1/churn asume churn constante. En restaurantes mexicanos, el churn es front-loaded (muchos cierran el primer ano). Ajuste realista:

| Escenario | Vida util ajustada | Justificacion |
|---|---|---|
| Conservador | 3 anos | 60% sobrevive ano 1, luego churn normal |
| Base | 4 anos | Clientes seleccionados (no cualquier restaurante) |
| Optimista | 5.5 anos | Solo restaurantes establecidos (2+ anos operando) |

### LTV calculado

| Escenario | Precio | Margen/mes (sin Daniel) | Vida util | LTV |
|---|---|---|---|---|
| Conservador ($1,999) | $1,999 | $1,549 | 36 meses | $55,764 MXN ($3,195 USD) |
| Base ($1,999) | $1,999 | $1,549 | 48 meses | $74,352 MXN ($4,261 USD) |
| Optimista ($1,999) | $1,999 | $1,549 | 66 meses | $102,234 MXN ($5,859 USD) |
| Conservador ($1,499) | $1,499 | $1,049 | 36 meses | $37,764 MXN ($2,164 USD) |

### Ratio LTV:CAC

| Escenario | LTV | CAC | Ratio | Veredicto |
|---|---|---|---|---|
| Conservador | $55,764 | $12,000 | 4.6:1 | Excelente |
| Base | $74,352 | $10,600 | 7.0:1 | Sobresaliente |
| Optimista | $102,234 | $9,200 | 11.1:1 | Excepcional |

Benchmark: La mediana SaaS B2B es 3.2-3.6:1 (Optifai/Benchmarkit 2024-2025). Minimo saludable es 3:1. Fullsite esta muy por encima, pero es porque el CAC es artificialmente bajo (Daniel no se paga, Andres sin base).

---

## 4. Periodo de Payback

Cuando recuperas el CAC de cada restaurante:

| Escenario | CAC | Margen/mes | Meses para payback |
|---|---|---|---|
| Conservador (con bono Eduardo alto) | $12,000 | $1,549 | 7.7 meses |
| Base | $10,600 | $1,549 | 6.8 meses |
| Optimista (sin bono Eduardo) | $7,200 | $1,549 | 4.6 meses |
| Si precio $1,499 (conservador) | $12,000 | $1,049 | 11.4 meses |

Benchmark SaaS SMB: El target es <12 meses de payback (First Page Sage 2025). Mediana SaaS general fue 16-18 meses en 2024.

Con $1,999: Payback de 5-8 meses. Excelente.
Con $1,499: Payback de 8-11 meses. Aceptable pero sin margen de error.

Recomendacion: Mantener $1,999 como precio minimo. La diferencia de $500/mes cambia dramaticamente la viabilidad del negocio.

---

## 5. El Cuello de Botella Eduardo

### Capacidad actual

| Parametro | Valor |
|---|---|
| Restaurantes por mes (part-time) | 4 |
| Horas por implementacion | ~8 hrs |
| Horas disponibles por mes (part-time) | ~40-60 hrs |
| Horas para implementacion pura | 32 hrs |
| Horas para soporte post-implementacion | 8-28 hrs |

### Proyeccion de crecimiento con Eduardo como unico implementador

| Mes | Nuevos restaurantes | Total acumulado | Limitado por Eduardo? |
|---|---|---|---|
| 1 | 2 | 2 | No |
| 2 | 3 | 5 | No |
| 3 | 4 | 9 | Cerca del limite |
| 4 | 4 | 13 | SI — maximo alcanzado |
| 5 | 4 | 17 | SI |
| 6 | 4 | 21 | SI |
| 12 | 4 | 33 | SI |

Techo duro: 4 restaurantes nuevos por mes. Sin segundo implementador, Fullsite crece linealmente, no exponencialmente.

### Que se rompe primero

1. **Mes 3-4**: Eduardo llega al limite de 4/mes. Si Andres cierra 5+ deals, hay cola de espera
2. **Mes 5-6**: El soporte post-implementacion empieza a comer las horas de Eduardo. Los primeros 10 restaurantes generan dudas, bugs, solicitudes
3. **Mes 8-10**: Eduardo necesita decidir: full-time o contratar ayudante. A part-time, ya no puede absorber soporte + implementaciones

### Costos para desbloquear

| Opcion | Costo/mes | Capacidad nueva |
|---|---|---|
| Eduardo full-time | $15,000-$25,000 MXN (salario) | 8-10 restaurantes/mes |
| Segundo implementador junior | $12,000-$15,000 MXN | +4 restaurantes/mes |
| Self-onboarding (inversion en producto) | 80-120 hrs de Daniel | Ilimitado (pero riesgo de calidad) |
| Documentacion + videos de capacitacion | 20-30 hrs de Daniel | Reduce hrs por implementacion a 4 |

Recomendacion: A 15 restaurantes, necesitas un segundo implementador o Eduardo full-time. El bono por implementacion ($3,000-$5,000 por restaurante) financia esto: 4 restaurantes/mes x $4,000 = $16,000 que cubren un salario junior.

---

## 6. El Cuello de Botella Daniel

### Roles actuales de Daniel

| Rol | Horas/semana estimadas | Sustituible? |
|---|---|---|
| Ingenieria (features, bugs, infra) | 25-35 hrs | NO (unico ingeniero) |
| Soporte tecnico L2/L3 | 5-10 hrs | Parcial (IA absorbe L1) |
| Ventas/demos | 3-5 hrs | SI (Andres deberia absorber) |
| Estrategia/CEO | 3-5 hrs | NO |
| Ops/deploy/monitoring | 2-3 hrs | Parcial (CI/CD) |
| **Total** | **38-58 hrs/semana** | |

### Capacidad maxima de Daniel por restaurantes

| Restaurantes | Soporte semanal | Desarrollo disponible | Estado |
|---|---|---|---|
| 1-5 | 2-4 hrs | 30+ hrs | Comodo. Puede construir features |
| 5-10 | 4-8 hrs | 25-30 hrs | Apretado. Priorizar es critico |
| 10-20 | 8-15 hrs | 20-25 hrs | Peligroso. Empieza a descuidar producto |
| 20-30 | 12-20 hrs | 15-20 hrs | Crisis. Necesita contratar soporte |
| 30-50 | 15-25 hrs | 10-15 hrs | Insostenible sin equipo |
| 50+ | Imposible solo | Minimo | El negocio se estanca o colapsa |

### Punto de quiebre

**15-20 restaurantes**: Daniel necesita o contratar soporte L1 ($8,000-$12,000 MXN/mes) o tener un sistema de soporte IA tan bueno que los restaurantes casi nunca escalen a humano.

**30 restaurantes**: Sin un segundo ingeniero, el producto se estanca. Los bugs se acumulan. Los features que los clientes necesitan no se construyen. El churn sube.

### Costo para desbloquear

| Hire | Cuando | Costo/mes | Que desbloquea |
|---|---|---|---|
| Soporte L1 | 15 restaurantes ($30K MRR) | $10,000 MXN | Daniel recupera 10-15 hrs/semana |
| Ingeniero junior | 30 restaurantes ($60K MRR) | $20,000-$25,000 MXN | Desarrollo no se detiene |
| Ops/implementation | 20 restaurantes ($40K MRR) | $12,000 MXN | Eduardo no es cuello de botella |

---

## 7. Comparacion con Toast

### Metricas clave Toast (datos publicos)

| Metrica | Toast 2024 | Fuente |
|---|---|---|
| Locations totales | ~134,000 | 10-K 2024 |
| Locations netas nuevas/ano | 28,000 (record) | Earnings Q4 2024 |
| ARR total | ~$1.6B | Earnings Q4 2024 |
| SaaS ARPU por location | ~$6,000 USD/ano ($500/mes) | Earnings calls, SaaStr |
| Total ARPU (SaaS + fintech) | ~$11,900 USD/ano | Calculado: $1.6B / 134K |
| S&M expense | $470M (2024) | 10-K 2024 |
| CAC implicito (S&M / locations nuevas) | ~$16,800 USD | Calculado: $470M / 28K |
| Gross margin (subscription) | ~65-70% | 10-K estimado |
| Net income | Primer ano rentable 2024 | Earnings |
| Costo setup por location | ~$13,250 USD | Analisis Risk Premium Research |
| EPS | $0.55 (2024) | Compounder Score |

### Comparacion directa

| Metrica | Toast | Fullsite | Ratio |
|---|---|---|---|
| ARPU SaaS mensual | $500 USD ($8,725 MXN) | $1,999 MXN ($115 USD) | Toast 4.3x |
| CAC | $16,800 USD | $600 USD | Toast 28x |
| LTV:CAC | ~3-4:1 (estimado) | 4.6-11:1 | Fullsite 2-3x mejor |
| Margen bruto SaaS | ~65-70% | 77% (sin Daniel) | Similar |
| Costo implementacion | $13,250 USD | $287-$575 USD | Toast 23-46x |
| Tiempo a rentabilidad | 13 anos (2012-2024) | TBD | |
| Locations al IPO (2021) | ~48,000 | - | |

### Que puede aprender Fullsite de Toast

1. **El SaaS es la puerta, fintech es el negocio**. Toast cobra ~$500/mes por software, pero gana mas por procesamiento de pagos (2.49% + $0.15 por transaccion). A escala, el software es casi un loss-leader.

2. **ARPU sube con el tiempo**. Toast empezo con ARPU mas bajo y lo crece 5% anual con upsells (marketing, payroll, delivery integration). Fullsite deberia planear modulos premium desde ahora.

3. **El CAC alto funciona si el LTV lo justifica**. Toast gasta $16,800 por restaurante porque sabe que le va a sacar $60,000-$80,000 en su vida util. Fullsite NO debe copiar este modelo con CAC alto. Su ventaja es la eficiencia.

4. **La escala tarda**. Toast tardo 13 anos en ser rentable, levanto $900M+ en capital. Fullsite no tiene ese lujo. Debe ser rentable (o al menos cash-flow positive) mucho antes.

5. **Multi-producto es obligatorio**. Toast tiene POS, KDS, payroll, marketing, delivery, fintech. Fullsite ya tiene POS + KDS + IA + inventario, lo cual es mas completo que Toast al inicio.

---

## 8. Break-even Analysis

### Costos fijos mensuales (que hay que cubrir)

| Concepto | Costo/mes | Notas |
|---|---|---|
| Daniel costo de vida minimo | $25,000-$30,000 MXN | Monterrey, viviendo austero |
| Herramientas (Vercel, Supabase, dominio, etc.) | $2,000-$3,000 MXN | Ya optimizado |
| Sales Navigator (si se activa) | $1,700 MXN (~$100 USD) | Opcional por ahora |
| Telefono/internet | $1,000 MXN | |
| **Total fijos minimos** | **$29,000-$35,000 MXN** | |

### Costos variables por restaurante

| Concepto | Costo/mes |
|---|---|
| API Claude | $200 MXN |
| Comision Andres | $200 MXN |
| **Total variable** | **$400 MXN** |

### Margen de contribucion

- A $1,999: $1,999 - $400 = $1,599 MXN/restaurante/mes
- A $1,499: $1,499 - $400 = $1,099 MXN/restaurante/mes

### Restaurantes para break-even

| Escenario | Costos fijos | Margen contribucion | Restaurantes necesarios |
|---|---|---|---|
| Minimo viable ($1,999) | $29,000 | $1,599 | **19 restaurantes** |
| Comodo ($1,999) | $35,000 | $1,599 | **22 restaurantes** |
| Minimo viable ($1,499) | $29,000 | $1,099 | **27 restaurantes** |
| Comodo ($1,499) | $35,000 | $1,099 | **32 restaurantes** |

### Break-even extendido (con equipo minimo)

A 20+ restaurantes necesitas contratar. Nuevo break-even:

| Concepto | Costo/mes |
|---|---|
| Daniel | $30,000 |
| Soporte L1 (1 persona) | $10,000 |
| Eduardo full-time (o equivalente) | $15,000 |
| Andres base (minimo viable) | $10,000 |
| Herramientas | $3,000 |
| **Total fijos con equipo** | **$68,000 MXN** |

| Escenario | Costos fijos | Margen contribucion | Restaurantes necesarios |
|---|---|---|---|
| Con equipo ($1,999) | $68,000 | $1,599 | **43 restaurantes** |
| Con equipo ($1,499) | $68,000 | $1,099 | **62 restaurantes** |

Nota: Andres se beneficia de comision recurrente. Su $10,000/mes base + 10% recurrente de 30 restaurantes ($6,000) = $16,000/mes. Viable.

---

## 9. Modelado de Escenarios (Meses 1-12)

### Supuestos comunes
- Precio: $1,999 MXN/mes
- Churn: 1.5% mensual (18% anual)
- Eduardo implementa max 4/mes
- Sin marketing pagado
- Bono Eduardo: $4,000 promedio por restaurante

### Escenario MEJOR CASO

Andres cierra 4-6/mes, referrals empiezan mes 4, Eduardo a full-time mes 5.

| Mes | Nuevos | Churn | Total | MRR | Costos fijos | Costos var | Gasto CAC | Cash flow |
|---|---|---|---|---|---|---|---|---|
| 1 | 3 | 0 | 3 | $5,997 | $32,000 | $1,200 | $30,000 | -$57,203 |
| 2 | 4 | 0 | 7 | $13,993 | $32,000 | $2,800 | $40,000 | -$60,807 |
| 3 | 4 | 0 | 11 | $21,989 | $32,000 | $4,400 | $40,000 | -$54,411 |
| 4 | 5 | 0 | 16 | $31,984 | $32,000 | $6,400 | $50,000 | -$56,416 |
| 5 | 6 | 0 | 22 | $43,978 | $47,000 | $8,800 | $60,000 | -$71,822 |
| 6 | 6 | 1 | 27 | $53,973 | $47,000 | $10,800 | $60,000 | -$63,827 |
| 7 | 7 | 0 | 34 | $67,966 | $47,000 | $13,600 | $70,000 | -$62,634 |
| 8 | 7 | 1 | 40 | $79,960 | $47,000 | $16,000 | $70,000 | -$53,040 |
| 9 | 8 | 1 | 47 | $93,953 | $47,000 | $18,800 | $80,000 | -$51,847 |
| 10 | 8 | 1 | 54 | $107,946 | $47,000 | $21,600 | $80,000 | -$40,654 |
| 11 | 8 | 1 | 61 | $121,939 | $47,000 | $24,400 | $80,000 | -$29,461 |
| 12 | 8 | 1 | 68 | $135,932 | $47,000 | $27,200 | $80,000 | -$18,268 |

Mejor caso 12 meses:
- Total restaurantes: 68
- MRR mes 12: $135,932 MXN (~$7,789 USD)
- ARR implicito: $1,631,184 MXN (~$93,500 USD)
- Cash burn total: ~$620,000 MXN (~$35,500 USD)
- Break-even operativo: ~mes 14-15

### Escenario BASE

Andres cierra 2-3/mes, Eduardo part-time, crecimiento organico lento.

| Mes | Nuevos | Churn | Total | MRR | Costos fijos | Costos var | Gasto CAC | Cash flow |
|---|---|---|---|---|---|---|---|---|
| 1 | 2 | 0 | 2 | $3,998 | $32,000 | $800 | $20,000 | -$48,802 |
| 2 | 2 | 0 | 4 | $7,996 | $32,000 | $1,600 | $20,000 | -$45,604 |
| 3 | 3 | 0 | 7 | $13,993 | $32,000 | $2,800 | $30,000 | -$50,807 |
| 4 | 3 | 0 | 10 | $19,990 | $32,000 | $4,000 | $30,000 | -$46,010 |
| 5 | 3 | 0 | 13 | $25,987 | $32,000 | $5,200 | $30,000 | -$41,213 |
| 6 | 3 | 0 | 16 | $31,984 | $32,000 | $6,400 | $30,000 | -$36,416 |
| 7 | 3 | 1 | 18 | $35,982 | $32,000 | $7,200 | $30,000 | -$33,218 |
| 8 | 3 | 0 | 21 | $41,979 | $32,000 | $8,400 | $30,000 | -$28,421 |
| 9 | 3 | 1 | 23 | $45,977 | $32,000 | $9,200 | $30,000 | -$25,223 |
| 10 | 3 | 0 | 26 | $51,974 | $35,000 | $10,400 | $30,000 | -$23,426 |
| 11 | 3 | 1 | 28 | $55,972 | $35,000 | $11,200 | $30,000 | -$20,228 |
| 12 | 3 | 0 | 31 | $61,969 | $35,000 | $12,400 | $30,000 | -$15,431 |

Caso base 12 meses:
- Total restaurantes: 31
- MRR mes 12: $61,969 MXN (~$3,552 USD)
- ARR implicito: $743,628 MXN (~$42,620 USD)
- Cash burn total: ~$415,000 MXN (~$23,800 USD)
- Break-even operativo: ~mes 18-20

### Escenario PEOR CASO

Andres cierra 1-2/mes, churn alto, Eduardo inconsistente.

| Mes | Nuevos | Churn | Total | MRR | Costos fijos | Costos var | Gasto CAC | Cash flow |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 0 | 1 | $1,999 | $32,000 | $400 | $10,000 | -$40,401 |
| 2 | 1 | 0 | 2 | $3,998 | $32,000 | $800 | $10,000 | -$38,802 |
| 3 | 2 | 0 | 4 | $7,996 | $32,000 | $1,600 | $20,000 | -$45,604 |
| 4 | 1 | 0 | 5 | $9,995 | $32,000 | $2,000 | $10,000 | -$34,005 |
| 5 | 2 | 1 | 6 | $11,994 | $32,000 | $2,400 | $20,000 | -$42,406 |
| 6 | 1 | 0 | 7 | $13,993 | $32,000 | $2,800 | $10,000 | -$30,807 |
| 7 | 2 | 1 | 8 | $15,992 | $32,000 | $3,200 | $20,000 | -$39,208 |
| 8 | 1 | 0 | 9 | $17,991 | $32,000 | $3,600 | $10,000 | -$27,609 |
| 9 | 1 | 1 | 9 | $17,991 | $32,000 | $3,600 | $10,000 | -$27,609 |
| 10 | 2 | 0 | 11 | $21,989 | $32,000 | $4,400 | $20,000 | -$34,411 |
| 11 | 1 | 1 | 11 | $21,989 | $32,000 | $4,400 | $10,000 | -$24,411 |
| 12 | 1 | 0 | 12 | $23,988 | $32,000 | $4,800 | $10,000 | -$22,812 |

Peor caso 12 meses:
- Total restaurantes: 12
- MRR mes 12: $23,988 MXN (~$1,374 USD)
- ARR implicito: $287,856 MXN (~$16,500 USD)
- Cash burn total: ~$408,000 MXN (~$23,400 USD)
- Break-even operativo: NUNCA con esta trayectoria (necesita >19 restaurantes)

---

## 10. Riesgos Criticos para Unit Economics

| Riesgo | Probabilidad | Impacto | Mitigacion |
|---|---|---|---|
| Daniel se quema (burnout) | ALTA | FATAL | Contratar soporte a 15 restaurantes |
| Churn mas alto de lo esperado | MEDIA | ALTO | Onboarding excelente, soporte proactivo |
| Eduardo se va o reduce disponibilidad | MEDIA | ALTO | Documentar proceso, segundo implementador |
| Andres no cierra deals | MEDIA | ALTO | Pipeline diversificado, referrals |
| Costo API Claude sube | BAJA | MEDIO | Negociar volumen, cache, modelos mas baratos |
| Competidor entra con capital | MEDIA | ALTO | Velocidad de ejecucion, relaciones, servicio |
| Precio $1,999 es muy alto para mercado | BAJA | ALTO | Test con primeros 10, ajustar si churn > 25% |

---

## 11. Metricas Clave para Monitorear

| Metrica | Target | Frecuencia | Alarma si |
|---|---|---|---|
| MRR | Creciendo | Semanal | Baja 2 meses seguidos |
| Churn mensual | <2% | Mensual | >3% |
| CAC | <$12,000 MXN | Por deal | >$15,000 |
| Payback period | <8 meses | Por cohorte | >12 meses |
| Hrs soporte Daniel/restaurante | <2 hrs/mes | Mensual | >3 hrs/mes |
| Deals pipeline Andres | >8 prospectos | Semanal | <5 |
| Tiempo implementacion Eduardo | <8 hrs | Por restaurante | >12 hrs |
| NPS/satisfaccion | >8/10 | Trimestral | <7/10 |

---

## 12. La Verdad Desnuda

1. **$1,999 es el precio correcto.** A $1,499, el margen es demasiado delgado. La diferencia entre ambos precios ($500/mes) es la diferencia entre un negocio viable y uno que sobrevive.

2. **Los unit economics son buenos HOY, pero fragiles.** Funcionan porque Daniel no se paga y Andres no tiene base. Cuando eso cambie (y TIENE que cambiar para escalar), los numeros se aprietan.

3. **El break-even real con equipo es 43 restaurantes.** No 19. Porque a 19 ya necesitas contratar, y eso sube el break-even.

4. **Eduardo es el primer cuello de botella.** Max 4/mes. Si Andres empieza a cerrar 5+, hay un problema inmediato. Solucion: Eduardo full-time o segundo implementador.

5. **Daniel es el segundo cuello de botella y el mas peligroso.** Porque es insustituible a corto plazo. El negocio se construye o se muere por su capacidad. A 20 restaurantes, sin soporte, el producto se degrada.

6. **Comparado con Toast, Fullsite tiene MEJORES unit economics iniciales.** Pero Toast tiene escala, brand, y un moat de pagos. Fullsite necesita encontrar su propio moat (IA operativa? verticalizacion? data?).

7. **El escenario base es alcanzable.** 31 restaurantes en 12 meses es realista con ejecucion consistente. Pero requiere que Andres venda 3/mes de forma consistente. Eso no es trivial.

8. **Cash necesario para 12 meses (caso base):** ~$415,000 MXN (~$23,800 USD). Eso es lo que Daniel necesita tener ahorrado o generar de otra fuente para sobrevivir el ano.

---

## Fuentes

- [Toast S-1 Filing (SEC)](https://www.sec.gov/Archives/edgar/data/1650164/000119312521258447/d166297ds1.htm)
- [Toast 10-K FY2024 (SEC)](https://www.sec.gov/Archives/edgar/data/0001650164/000165016425000072/tost-20241231.htm)
- [Toast Q4 2024 Earnings](https://www.businesswire.com/news/home/20250219799274/en/Toast-Announces-Fourth-Quarter-and-Full-Year-2024-Financial-Results)
- [Toast Q4 2025 Earnings](https://www.businesswire.com/news/home/20260212058106/en/Toast-Announces-Fourth-Quarter-and-Full-Year-2025-Financial-Results)
- [5 Interesting Learnings from Toast at $6.5B (SaaStr)](https://www.saastr.com/5-interesting-learnings-from-toast-at-billion-in-arr/)
- [Toast Valuation (Risk Premium Research)](https://riskpremiumresearch.substack.com/p/toast-valuation)
- [SaaS Metrics Benchmarks 2025 (RockingWeb)](https://www.rockingweb.com.au/saas-metrics-benchmark-report-2025/)
- [CAC Payback Benchmarks (First Page Sage)](https://firstpagesage.com/reports/saas-cac-payback-benchmarks/)
- [B2B SaaS LTV Benchmarks — 939 Companies (Optifai)](https://optif.ai/learn/questions/b2b-saas-ltv-benchmark/)
- [SaaS Churn Benchmarks 2026 (Livmo)](https://livmo.com/blog/saas-churn-benchmarks-valuation/)
- [Average Churn Rate by Industry (CustomerGauge)](https://customergauge.com/blog/average-churn-rate-by-industry)
- [SaaS Gross Margin Benchmarks (CloudZero)](https://www.cloudzero.com/blog/saas-gross-margin-benchmarks/)
- [Por que cierran restaurantes en Mexico (Cooking Depot)](https://cookingdepot.com/blog/por-que-cierran-los-restaurantes-en-mexico)
- [60% de restaurantes fracasan primer ano (Restaurant MBA)](https://therestaurantmba.com/el-60-de-los-restaurantes-fracasan/)
- [Tipo de cambio julio 2026 (Banxico)](https://www.banxico.org.mx/SieInternet/consultarDirectorioInternetAction.do?sector=24)
- [Salario ingeniero software Mexico 2026 (talent.com)](https://mx.talent.com/salary?job=ingeniero+de+software)
- [CAC Benchmarks 2026 (Genesys Growth)](https://genesysgrowth.com/blog/customer-acquisition-cost-benchmarks-for-marketing-leaders)
- [Restaurant POS Costs 2026 (CrumblePOS)](https://crumblepos.com/blogs/how-much-does-a-restaurant-pos-system-cost-2026-guide/)
