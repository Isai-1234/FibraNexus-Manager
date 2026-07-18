-- 005_billing_payments.down.sql
DROP TABLE IF EXISTS invoice_adjustments;
DROP TABLE IF EXISTS payment_webhook_events;
DROP TABLE IF EXISTS payment_intents;
DROP TYPE IF EXISTS invoice_adjustment_type;
DROP TYPE IF EXISTS payment_intent_status;
