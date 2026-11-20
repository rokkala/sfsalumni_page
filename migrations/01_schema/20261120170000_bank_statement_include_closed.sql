-- While testing bank recon: match against paid receivable lines too (committee toggle).

alter table public.payment_checkout_settings
  add column if not exists bank_statement_include_closed_lines boolean not null default false;