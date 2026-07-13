-- Migration: Add canonical business-day configuration to clients
-- Date: 2026-07-13
-- Decision provenance: Daniel Ramonfaur, Jul 13 2026 WAR ROOM session.
--
-- Context:
--   pos_intraday_snapshot used hardcoded 5am boundary (commit 58fbe8b).
--   pos_daily_aggregator used midnight boundary (commit ebf0189).
--   Divergence confirmed: order closed at 1:00 AM local was attributed to
--   Jul 12 by snapshot but Jul 13 by aggregator (STOP-THE-LINE).
--
-- Boundary choice rationale:
--   - Wansoft transaction-level data not available (only daily aggregates).
--   - All 12 observed AMALAY Fullsite orders close between 18:25-22:20 local.
--   - Candidates 00:00-06:00 produce identical results for observed data.
--   - 05:00 preserves late-night restaurant continuity across calendar midnight.
--   - This is an explicit operational policy decision, not derived from data.
--
-- Timezone change rationale:
--   - America/Mexico_City and America/Monterrey are functionally identical
--     (both UTC-6 year-round since DST abolition Oct 2022).
--   - America/Monterrey is geographically correct for AMALAY (San Pedro, NL).

-- 1. Add business_day_start_local column (TIME, not integer hour)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS business_day_start_local TIME;

COMMENT ON COLUMN clients.business_day_start_local IS
  'Local time marking the start of a business day. Orders closed before this time '
  'belong to the previous business day. All producers must read this config — '
  'no hardcoded fallbacks. TYPE=TIME to support boundaries like 04:30 without migration.';

-- 2. Set AMALAY canonical config
UPDATE clients
SET business_day_start_local = '05:00:00',
    timezone = 'America/Monterrey'
WHERE id = 'amalay';

-- 3. Verify
SELECT id, timezone, business_day_start_local
FROM clients
WHERE id = 'amalay';
-- Expected: amalay | America/Monterrey | 05:00:00
