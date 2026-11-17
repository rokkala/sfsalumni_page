-- Remittance method + structured meta on offline payment proofs (UPI daily quota index).

alter table public.offline_payment_proofs
  add column if not exists remittance_method text,
  add column if not exists payment_date date,
  add column if not exists remittance_meta jsonb not null default '{}'::jsonb;

alter table public.offline_payment_proofs
  drop constraint if exists offline_payment_proofs_remittance_method_check;

alter table public.offline_payment_proofs
  add constraint offline_payment_proofs_remittance_method_check check (
    remittance_method is null
    or remittance_method in (
      'neft_rtgs',
      'cash_cheque',
      'class_representative',
      'foreign',
      'upi'
    )
  );

update public.offline_payment_proofs
set
  remittance_method = case
    when utr ~ '^\d{12}$' then 'upi'
    else 'neft_rtgs'
  end,
  payment_date = coalesce(
    payment_date,
    ((created_at at time zone 'Asia/Kolkata')::date)
  )
where remittance_method is null;

alter table public.offline_payment_proofs
  alter column remittance_method set default 'neft_rtgs';

update public.offline_payment_proofs
set remittance_method = 'neft_rtgs'
where remittance_method is null;

alter table public.offline_payment_proofs
  alter column remittance_method set not null;

update public.offline_payment_proofs
set payment_date = ((created_at at time zone 'Asia/Kolkata')::date)
where payment_date is null;

alter table public.offline_payment_proofs
  alter column payment_date set not null;

create index if not exists idx_offline_proofs_upi_day
  on public.offline_payment_proofs (created_at)
  where remittance_method = 'upi' and status in ('pending', 'approved');