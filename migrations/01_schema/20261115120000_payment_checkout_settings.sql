-- Committee toggle: show Cashfree "Pay online" alongside Bank/UPI (keys still required in env).

create table if not exists public.payment_checkout_settings (
  id text primary key default 'default' check (id = 'default'),
  online_checkout_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.payment_checkout_settings (id, online_checkout_enabled)
values ('default', false)
on conflict (id) do nothing;

alter table public.payment_checkout_settings enable row level security;
revoke all on table public.payment_checkout_settings from anon, authenticated;
grant all on table public.payment_checkout_settings to service_role;