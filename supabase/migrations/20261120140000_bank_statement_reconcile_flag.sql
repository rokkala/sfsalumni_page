-- Committee toggle: SIB PDF upload + auto-match on Receivables (instant rollback via admin).

alter table public.payment_checkout_settings
  add column if not exists bank_statement_reconcile_enabled boolean not null default true;a