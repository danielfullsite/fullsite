-- ═══════════════════════════════════════════════════════════
-- FULLSITE TRIGGERS
-- Generated: 2026-07-21 from production
-- Triggers: 12
-- ═══════════════════════════════════════════════════════════

-- ── realtime.subscription.tr_check_filters ──
CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();

-- ── storage.buckets.enforce_bucket_name_length_trigger ──
CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();

-- ── storage.buckets.protect_buckets_delete ──
CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

-- ── storage.objects.protect_objects_delete ──
CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

-- ── storage.objects.update_objects_updated_at ──
CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();

-- ── reviews.reviews_set_updated_at ──
CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── amalay_reservaciones.set_codigo_reserva ──
CREATE TRIGGER set_codigo_reserva BEFORE INSERT ON public.amalay_reservaciones FOR EACH ROW EXECUTE FUNCTION gen_codigo_reserva();

-- ── amalay_reservaciones.trg_reservaciones_updated_at ──
CREATE TRIGGER trg_reservaciones_updated_at BEFORE UPDATE ON public.amalay_reservaciones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── cron.job.cron_job_cache_invalidate ──
CREATE TRIGGER cron_job_cache_invalidate AFTER INSERT OR DELETE OR UPDATE OR TRUNCATE ON cron.job FOR EACH STATEMENT EXECUTE FUNCTION cron.job_cache_invalidate();

-- ── pos_orders.trg_pos_order_number ──
CREATE TRIGGER trg_pos_order_number BEFORE INSERT ON public.pos_orders FOR EACH ROW EXECUTE FUNCTION set_pos_order_number();

-- ── pos_orders.trg_pos_orders_updated_at ──
CREATE TRIGGER trg_pos_orders_updated_at BEFORE UPDATE ON public.pos_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── events.events_immutable ──
CREATE TRIGGER events_immutable BEFORE DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION reject_mutation();

