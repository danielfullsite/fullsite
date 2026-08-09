# Demo Dataset Provenance

**Tenant:** `demo` (El Molcajete Demo)  
**Environment:** `DEMO` (staging only — never production)  
**Source tag:** `SIMULATED`  
**Created:** TSK-005 DEMO-FOUNDATION

---

## Dataset origin

All data is **synthetically generated** by `demo_seed.py`. No real restaurant data,
no PII, and no production data from any Fullsite client is used. The dataset is
modeled as a generic Mexican restaurant ("El Molcajete Demo") for demonstration
and sales purposes.

---

## Generation algorithm

The seed uses Python's `random.Random(seed_val)` initialized with `seed_val=42`.
UUIDs are derived via `uuid.UUID(int=rng.getrandbits(128))` — each call to
`getrandbits(128)` advances the RNG deterministically so the same sequence of IDs
is always produced.

Because prices and capacities are **hardcoded constants** (not drawn from the RNG),
the generated data is stable across Python versions.

**Default seed:** `42`

---

## Datasets

| Dataset | Count | Generation method |
|---|---|---|
| Menu items | 30 (5 categories × 6 items) | Hardcoded names + prices; UUIDs from RNG |
| Tables | 10 (Mesa 1–10) | Hardcoded capacities; UUIDs from RNG |
| Staff (meseros) | 5 | Hardcoded names; UUIDs from RNG |
| Client record | 1 | Fully static — no RNG dependency |

### Menu categories

- Entradas (6 items)
- Platillos fuertes (6 items)
- Tacos (6 items)
- Bebidas (6 items)
- Postres (6 items)

### Staff names (synthetic — not real people)

- Ana García
- Carlos Méndez
- Diana Torres
- Eduardo Reyes
- Fernanda López

---

## Date range

No date-range data is generated in Phase 0. Sales history and orders are out of
scope for TSK-005 (Phase 0). Future phases (TSK-006..TSK-009) will add transactional
data with date ranges covering the last 90 days of synthetic activity.

---

## Isolation guarantees

- Every row has `source = 'SIMULATED'`
- Every row has `environment = 'DEMO'`
- `client_id` is always `'demo'`
- No row references AMALAY, Nómada, or any production client
- Scripts refuse to run against production URLs (fail-closed)

---

## How to regenerate from scratch

```bash
# 1. Teardown existing demo data
python scripts/demo/demo_reset.py --seed 42

# 2. Seed only (if tenant already exists)
python scripts/demo/demo_seed.py --seed 42

# 3. Dry run (no writes) — preview what would be inserted
python scripts/demo/demo_seed.py --seed 42 --dry-run

# 4. Run tests (no network required — all mocked)
cd scripts/demo
python -m pytest tests/ -v
```

Required environment variables (staging only):
```
STAGING_SUPABASE_URL=https://jkcnxfbbuyyfhwfjizgw.supabase.co
STAGING_SUPABASE_KEY=<staging service_role key>
```

---

## Isolation gate reference

| Gate | Check |
|---|---|
| IG-01 | `client_id != 'demo'` → `RuntimeError` immediately |
| IG-02 | Production URL in call → `RuntimeError` before any HTTP |
| IG-03 | All rows: `source == 'SIMULATED'` |
| IG-04 | All rows: `environment == 'DEMO'` |
| IG-05 | Same `--seed 42` → identical row IDs and content |
| IG-06 | Every log line: starts with `[DEMO][ISOLATED]` |
| IG-07 | DELETE queries: `WHERE client_id = 'demo'` only |
| IG-08 | No AMALAY data, no AMALAY staff names in demo seed |
| IG-09 | `demo_reset.py` completes in < 30s |

All gates are tested in `tests/test_demo_isolation.py`.
