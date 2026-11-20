# Deploy and rollback

## Bank statement feature (no redeploy)

While testing **Receivables → bank statement** reconciliation:

1. **Admin toggle** — on `/admin/receivables`, uncheck **Bank statement upload & match**.  
   Upload and apply APIs return 403 until you turn it back on.

2. **Vercel env kill switch** — set `BANK_STATEMENT_RECONCILE_ENABLED=false` on the project and redeploy (or save env only if your plan supports runtime env).  
   The admin toggle is disabled while this env is set.

3. **Database migration** — `20261120140000_bank_statement_reconcile_flag.sql` adds the toggle column (default **on**).  
   Apply in Supabase SQL Editor if the checkbox cannot be saved.

This does **not** undo mark-paid actions already applied from a statement — use **Mark unpaid** on receivable lines or proof rejection if you settled by mistake.

## Whole-site rollback (Vercel)

From the repo root (Vercel CLI logged in):

```bash
npm run deploy:list    # recent production deployments
npm run deploy:rollback   # promote previous production deployment
```

Or in the [Vercel dashboard](https://vercel.com): **Deployments** → pick an older **Production** deployment → **⋯** → **Promote to Production**.

Forward again:

```bash
npm run deploy:prod
```

Production site for this project: **https://www.sfsalumnis.com**

## Git

Production deploys from CLI upload the **local folder**. For reproducible rollbacks, commit before `npm run deploy:prod` and note the deployment id in Vercel.