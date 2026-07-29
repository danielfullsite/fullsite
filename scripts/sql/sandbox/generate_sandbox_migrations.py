#!/usr/bin/env python3
"""
SKEL-01 sandbox migration generator.

Reads production migrations, applies deterministic transformations,
writes sandbox-safe SQL files to scripts/sql/sandbox/migrations/.

The output files are committed to git and applied directly.
No runtime sed or manual editing needed.

Run: python3 scripts/sql/sandbox/generate_sandbox_migrations.py

Verify: grep -rn "DEFAULT 'amalay'" scripts/sql/sandbox/migrations/
        grep -rn "amalay_reservaciones" scripts/sql/sandbox/migrations/
"""
import re
import sys
from pathlib import Path

SRC = Path(__file__).parent.parent / "migrations"
OUT = Path(__file__).parent / "migrations"

AMALAY_PROJECT_REF = "qjiomlvudfmzuvqvhwpk"  # never appears in sandbox output

SANDBOX_HEADER = """-- =============================================================================
-- SANDBOX-SAFE MIGRATION
-- Source:  {source}
-- Branch:  sandbox/second-customer-skeleton
-- Project: fullsite-sandbox (NEVER apply to {prod_ref})
--
-- Transformations applied:
{transforms}
-- =============================================================================

"""

# Functions to omit entirely from 004_functions.sql
# These reference amalay_reservaciones directly or contain hardcoded client_id='amalay'
OMIT_FUNCTIONS = {
    "cancel_stale_pending_reservations",  # mutates amalay_reservaciones directly
    "gen_codigo_reserva",                 # trigger function for amalay_reservaciones
    "r1_observation_sample",              # 10 hardcoded client_id='amalay' literals
}


# ─────────────────────────────────────────────────────────────────────────────
# 000_extensions.sql  (no changes needed)
# ─────────────────────────────────────────────────────────────────────────────
def transform_000(text):
    return text


# ─────────────────────────────────────────────────────────────────────────────
# 010_consolidated_core.sql
# ─────────────────────────────────────────────────────────────────────────────
def transform_010(text):
    """
    1. Skip every line referencing amalay_reservaciones.
    2. client_id columns: remove DEFAULT 'amalay', ensure NOT NULL.
    3. Non-tenant columns (restaurante, location_id, etc.): remove DEFAULT 'amalay'/'amalay-spgg', keep nullable.
    """
    lines = text.splitlines(keepends=True)
    out = []

    for line in lines:
        # Rule 1: drop amalay_reservaciones entirely
        if "amalay_reservaciones" in line:
            continue

        stripped = line.lstrip()

        # Rule 2a: client_id column with DEFAULT 'amalay' — remove default, enforce NOT NULL
        if stripped.startswith("client_id") and "DEFAULT 'amalay'" in line:
            line = re.sub(r"\s+DEFAULT\s+'amalay'::text", "", line)
            if "NOT NULL" not in line:
                line = re.sub(r"(client_id\s+TEXT)(,|\s*\n)", r"\1 NOT NULL\2", line)

        # Rule 2b: client_id column without any default but still nullable — enforce NOT NULL.
        # Covers cases like client_users.client_id TEXT which never had DEFAULT 'amalay'
        # but must still be NOT NULL (any tenant-aware table must have non-nullable client_id).
        elif stripped.startswith("client_id") and "DEFAULT 'amalay'" not in line:
            if "NOT NULL" not in line:
                line = re.sub(r"(client_id\s+TEXT)(,|\s*\n)", r"\1 NOT NULL\2", line)

        # Rule 3: non-tenant columns with DEFAULT 'amalay'/'amalay-spgg' — remove default, keep nullable
        elif "DEFAULT 'amalay" in line and not stripped.startswith("client_id"):
            line = re.sub(r"\s+DEFAULT\s+'amalay(?:-spgg)?'::text", "", line)

        out.append(line)

    return "".join(out)


# ─────────────────────────────────────────────────────────────────────────────
# 003_rls_policies.sql
# ─────────────────────────────────────────────────────────────────────────────
def transform_003(text):
    """
    Skip the amalay_reservaciones policy section.
    All other policies kept as-is (USING(true) is bootstrap-acceptable for demo).
    SKEL-04 will tighten the subset used by the demo flow.
    """
    lines = text.splitlines(keepends=True)
    out = []
    in_amalay_block = False

    for line in lines:
        # Detect amalay_reservaciones section start
        if "-- ── amalay_reservaciones ──" in line:
            in_amalay_block = True
            out.append("-- OMITTED: amalay_reservaciones policies (table does not exist in sandbox)\n\n")
            continue

        # Detect any other section start (ends amalay block)
        if in_amalay_block and re.match(r"^-- ── \w", line):
            in_amalay_block = False

        if not in_amalay_block:
            out.append(line)

    return "".join(out)


# ─────────────────────────────────────────────────────────────────────────────
# 004_functions.sql
# ─────────────────────────────────────────────────────────────────────────────
def split_functions(text):
    """
    Split into (preamble, list of function blocks).
    Each block starts at '-- ── name ──' and ends just before the next.
    """
    marker = re.compile(r"^(-- ── .+? ──\s*)$", re.MULTILINE)
    matches = list(marker.finditer(text))
    if not matches:
        return text, []

    preamble = text[:matches[0].start()]
    blocks = []
    for i, m in enumerate(matches):
        fn_label = re.search(r"-- ── (.+?) ──", m.group()).group(1).strip()
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        blocks.append({"name": fn_label, "text": text[start:end]})

    return preamble, blocks


def parse_fn_signature(block_text):
    """
    Return (fn_name, type_list_str) for REVOKE/GRANT, e.g.:
      ('r1_save_order', 'text, text, bigint, integer, ...')
    Returns None if not parseable.
    """
    m = re.search(
        r"CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)",
        block_text,
        re.DOTALL
    )
    if not m:
        return None

    fn_name = m.group(1)
    raw_params = m.group(2).strip()

    if not raw_params:
        return (fn_name, "")

    type_parts = []
    # Each parameter is: [name] type [DEFAULT expr]
    # We want only the type.
    # Types can be multi-word: 'timestamp with time zone', 'character varying', etc.
    for param in raw_params.split(","):
        param = param.strip()
        if not param:
            continue
        # Remove DEFAULT ... clause
        param = re.sub(r"\s+DEFAULT\s+.*$", "", param, flags=re.IGNORECASE).strip()
        # Remove VARIADIC / IN / OUT / INOUT
        param = re.sub(r"^(VARIADIC|IN|OUT|INOUT)\s+", "", param, flags=re.IGNORECASE).strip()
        tokens = param.split()
        # Heuristic: if first token looks like a parameter name (doesn't match known type keywords),
        # skip it and treat the rest as the type.
        pg_types = {
            "text", "integer", "int", "bigint", "smallint", "numeric", "boolean",
            "jsonb", "json", "uuid", "timestamptz", "timestamp", "date", "time",
            "void", "trigger", "record", "anyelement",
        }
        if tokens and tokens[0].lower() not in pg_types and not tokens[0].startswith("character"):
            tokens = tokens[1:]  # drop param name
        type_parts.append(" ".join(tokens))

    return (fn_name, ", ".join(type_parts))


def transform_004(text):
    preamble, blocks = split_functions(text)

    parts = [
        preamble,
        "-- SANDBOX: functions cancel_stale_pending_reservations, gen_codigo_reserva,\n"
        "-- r1_observation_sample OMITTED (directly reference amalay_reservaciones or\n"
        "-- contain hardcoded client_id=amalay). See generate_sandbox_migrations.py.\n\n",
    ]

    for block in blocks:
        fn_name = block["name"]
        body = block["text"]

        # Omit AMALAY-only functions
        if fn_name in OMIT_FUNCTIONS:
            parts.append(f"-- OMITTED IN SANDBOX: {fn_name}\n\n")
            continue

        is_definer = "SECURITY DEFINER" in body

        # Add SET search_path = 'public' to SECURITY DEFINER functions that lack it
        if is_definer and "SET search_path" not in body:
            body = re.sub(
                r"( SECURITY DEFINER\n)",
                r"\1 SET search_path = 'public'\n",
                body,
                count=1,
            )

        parts.append(body)

        # Add REVOKE/GRANT after each SECURITY DEFINER function
        if is_definer:
            sig = parse_fn_signature(body)
            if sig:
                fn_name_sig, types = sig
                full_sig = f"{fn_name_sig}({types})" if types else fn_name_sig
                parts.append(
                    f"REVOKE EXECUTE ON FUNCTION public.{full_sig} FROM PUBLIC;\n"
                    f"GRANT  EXECUTE ON FUNCTION public.{full_sig}"
                    f" TO authenticated, service_role;\n\n"
                )

    return "".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# 008_realtime.sql  (no changes needed)
# ─────────────────────────────────────────────────────────────────────────────
def transform_008(text):
    return text


# ─────────────────────────────────────────────────────────────────────────────
# Generator runner
# ─────────────────────────────────────────────────────────────────────────────
TRANSFORMS = [
    ("000_extensions_sandbox.sql",       "000_extensions.sql",       transform_000, [
        "No transformations — file is clean",
    ]),
    ("010_consolidated_core_sandbox.sql", "010_consolidated_core.sql", transform_010, [
        "Dropped all amalay_reservaciones lines (table, indexes, constraints)",
        "client_id columns: removed DEFAULT 'amalay', enforced NOT NULL",
        "Non-tenant columns (restaurante, location_id): removed DEFAULT 'amalay'/'amalay-spgg', kept nullable",
    ]),
    ("003_rls_policies_sandbox.sql",     "003_rls_policies.sql",     transform_003, [
        "Dropped amalay_reservaciones section",
        "All other policies kept as-is (USING(true) — tighten in SKEL-04 for demo tables)",
    ]),
    ("004_functions_sandbox.sql",        "004_functions.sql",        transform_004, [
        "OMITTED: cancel_stale_pending_reservations (amalay_reservaciones)",
        "OMITTED: gen_codigo_reserva (trigger for amalay_reservaciones)",
        "OMITTED: r1_observation_sample (hardcoded client_id=amalay)",
        "SECURITY DEFINER functions: SET search_path = 'public' added where missing",
        "SECURITY DEFINER functions: REVOKE FROM PUBLIC + GRANT TO authenticated/service_role",
    ]),
    ("008_realtime_sandbox.sql",         "008_realtime.sql",         transform_008, [
        "No transformations — file is clean",
    ]),
]


def make_header(source, transforms):
    t_lines = "\n".join(f"--   [{i+1}] {t}" for i, t in enumerate(transforms))
    return SANDBOX_HEADER.format(
        source=source,
        prod_ref=AMALAY_PROJECT_REF,
        transforms=t_lines,
    )


def verify_output(out_path, source):
    text = out_path.read_text()
    errors = []
    warnings = []

    # Must not contain production project ref outside of comments
    if AMALAY_PROJECT_REF in text:
        non_comment = "\n".join(
            l for l in text.splitlines()
            if not l.strip().startswith("--")
        )
        if AMALAY_PROJECT_REF in non_comment:
            errors.append(f"production project ref {AMALAY_PROJECT_REF} found outside comments")

    # Must not contain DEFAULT 'amalay' in client_id columns
    for i, line in enumerate(text.splitlines(), 1):
        if "DEFAULT 'amalay" in line and "OMITTED" not in line and "--" not in line.lstrip()[:3]:
            errors.append(f"line {i}: remaining DEFAULT 'amalay' — {line.strip()[:80]}")

    # client_id columns must be NOT NULL (warn if nullable)
    for i, line in enumerate(text.splitlines(), 1):
        stripped = line.lstrip()
        if stripped.startswith("client_id") and "NOT NULL" not in line and "client_id)" not in line:
            if "TEXT" in line or "text" in line:
                warnings.append(f"line {i}: client_id may be nullable — {line.strip()[:80]}")

    # amalay_reservaciones must not appear outside comments
    for i, line in enumerate(text.splitlines(), 1):
        if "amalay_reservaciones" in line and not line.strip().startswith("--"):
            errors.append(f"line {i}: non-comment reference to amalay_reservaciones")

    return errors, warnings


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    all_ok = True
    results = []

    for out_name, src_name, transform_fn, transforms in TRANSFORMS:
        src_path = SRC / src_name
        out_path = OUT / out_name

        if not src_path.exists():
            print(f"  MISSING source: {src_path}", file=sys.stderr)
            all_ok = False
            continue

        source_text = src_path.read_text()
        transformed = transform_fn(source_text)
        header = make_header(src_name, transforms)
        final = header + transformed

        out_path.write_text(final)

        errors, warnings = verify_output(out_path, src_name)

        status = "✓" if not errors else "✗"
        print(f"  {status} {out_name}")
        for e in errors:
            print(f"      ERROR: {e}", file=sys.stderr)
            all_ok = False
        for w in warnings:
            print(f"      WARN:  {w}")

        results.append((out_name, not errors, errors, warnings))

    print()
    if all_ok:
        print("All sandbox migrations generated and verified.")
        print()
        print("Final verification commands:")
        print(f"  grep -rn \"DEFAULT 'amalay'\" {OUT}/")
        print(f"  grep -rn \"amalay_reservaciones\" {OUT}/ | grep -v '\\-\\-'")
        print(f"  grep -rn \"{AMALAY_PROJECT_REF}\" {OUT}/")
    else:
        print("ERRORS found — review and fix generate_sandbox_migrations.py", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
