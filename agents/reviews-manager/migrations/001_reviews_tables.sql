-- ============================================================
-- Reviews Manager · SQL migration
-- Multi-tenant ready · AMALAY pilot
-- ============================================================

-- 1. google_reviews
CREATE TABLE IF NOT EXISTS google_reviews (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    client_slug             TEXT NOT NULL,

    review_id               TEXT NOT NULL,
    reviewer_name           TEXT,
    reviewer_photo_url      TEXT,
    star_rating             SMALLINT NOT NULL CHECK (star_rating BETWEEN 1 AND 5),
    comment                 TEXT,

    review_reply            TEXT,
    review_reply_at         TIMESTAMPTZ,

    create_time             TIMESTAMPTZ NOT NULL,
    update_time             TIMESTAMPTZ,
    synced_at               TIMESTAMPTZ DEFAULT NOW(),

    ai_draft                TEXT,
    ai_draft_at             TIMESTAMPTZ,
    generation_model        TEXT,

    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN (
                                'pending',
                                'ai_drafted',
                                'awaiting_approval',
                                'auto_approved',
                                'replied',
                                'flagged',
                                'ignored',
                                'error'
                            )),
    approved_by             TEXT,

    telegram_message_id     BIGINT,

    error_message           TEXT,
    retry_count             INTEGER DEFAULT 0,

    metadata                JSONB DEFAULT '{}'::JSONB,

    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(client_slug, review_id)
);

CREATE INDEX idx_google_reviews_client_status ON google_reviews(client_slug, status);
CREATE INDEX idx_google_reviews_pending ON google_reviews(status)
    WHERE status IN ('pending', 'ai_drafted', 'awaiting_approval');
CREATE INDEX idx_google_reviews_star_rating ON google_reviews(star_rating);
CREATE INDEX idx_google_reviews_create_time ON google_reviews(create_time DESC);


-- 2. google_oauth_tokens
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    client_slug             TEXT NOT NULL,

    provider                TEXT NOT NULL DEFAULT 'google_gbp',
    oauth_client_id         TEXT NOT NULL,
    access_token            TEXT NOT NULL,
    refresh_token           TEXT NOT NULL,
    token_type              TEXT DEFAULT 'Bearer',
    expires_at              TIMESTAMPTZ NOT NULL,
    scope                   TEXT,

    account_id              TEXT,
    location_id             TEXT,

    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(client_slug, provider)
);


-- 3. review_actions_log
CREATE TABLE IF NOT EXISTS review_actions_log (
    id                      BIGSERIAL PRIMARY KEY,
    review_id               UUID NOT NULL REFERENCES google_reviews(id) ON DELETE CASCADE,
    action                  TEXT NOT NULL CHECK (action IN (
                                'ai_draft_generated',
                                'draft_approved',
                                'draft_rejected',
                                'draft_edited',
                                'reply_published',
                                'reply_failed',
                                'alert_sent',
                                'flagged',
                                'ignored'
                            )),
    actor                   TEXT NOT NULL DEFAULT 'system',
    details                 JSONB DEFAULT '{}'::JSONB,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_review_actions_review_id ON review_actions_log(review_id);
CREATE INDEX idx_review_actions_action ON review_actions_log(action);
CREATE INDEX idx_review_actions_created_at ON review_actions_log(created_at DESC);


-- ============================================================
-- Trigger: updated_at automatico
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_google_reviews_updated_at
    BEFORE UPDATE ON google_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_google_oauth_tokens_updated_at
    BEFORE UPDATE ON google_oauth_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE google_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_actions_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access google_reviews"
    ON google_reviews FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access google_oauth_tokens"
    ON google_oauth_tokens FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access review_actions_log"
    ON review_actions_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);
