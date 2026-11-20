-- Remember bank rows already reconciled so daily full-month PDF uploads skip them.

create table if not exists public.bank_statement_settled_credits (
  fingerprint text primary key,
  stmt_date text not null,
  amount_paise integer not null check (amount_paise > 0),
  rrn text,
  line_key text,
  settled_at timestamptz not null default now()
);

create index if not exists bank_statement_settled_credits_settled_at
  on public.bank_statement_settled_credits (settled_at desc);

alter table public.bank_statement_settled_credits enable row level security;
revoke all on table public.bank_statement_settled_credits from anon, authenticated;
grant all on table public.bank_statement_settled_credits to service_role;