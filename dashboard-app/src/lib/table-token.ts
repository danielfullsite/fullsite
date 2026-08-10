// BUG-019-A — public table token contract.
//
// A table token is the opaque public identity of a mesa for QR flows. It is
// generated in the database (pgcrypto gen_random_bytes(24) -> 48 lowercase hex
// chars = 192 bits) and resolved SERVER-SIDE ONLY to client_id + location_id +
// mesa. The browser only ever carries this string; it never sends client_id.
//
// This module is the shared format guard. Public endpoints (BATCH B/C) validate
// the token shape BEFORE touching the database — cheap defense-in-depth that
// rejects malformed/injection input without a query, and keeps the resolver a
// single-row lookup by exact token (never an enumeration).
//
// The canonical server-side resolver query (run with the service role) is:
//
//   select client_id, location_id, number as mesa
//   from public.pos_mesas
//   where public_token = $1
//     and token_active
//     and active
//     and location_id is not null;   -- fail closed: no row => 404
//
// It returns exactly zero or one row. There is no list/enumerate path and no
// anon-executable function that exposes tokens.

/** 48 lowercase hex chars (24 bytes / 192 bits), URL-safe by construction. */
export const TABLE_TOKEN_REGEX = /^[0-9a-f]{48}$/;

/** True only for a well-formed table token. Use before any DB lookup. */
export function isValidTableTokenFormat(token: unknown): token is string {
  return typeof token === "string" && TABLE_TOKEN_REGEX.test(token);
}

/** Shape returned by the server-side resolver. All fields are server-derived. */
export interface ResolvedTable {
  client_id: string;
  location_id: string;
  mesa: number;
}
