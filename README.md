# Emirates Auction V2 — administration panel

Separate Next.js 16 administration repository for the Emirates Auction V2 platform. The static Cloudflare Worker frontend uses the VPS API as its only source of auction, user, payment and audit data.

## Available operations

- Dashboard for lots, categories, users, bids, balances, invoices, crypto payments, withdrawals and immutable audit history.
- Create and edit draft lots; publish, pause, extend, end, reopen, reset or archive a round.
- Variable deposit percentage, minimum bidding-limit base, absolute minimum and checkout eligibility per lot.
- Manual winner selection and private payment popup.
- Fixed 48-hour payment deadline after adjudication.
- Manual default workflow: cancel purchase, forfeit the security deposit, apply the 30% penalty, optionally calculate AED 105 per applicable late day, prepare the lot as a new draft round and flag legal review.
- Review and approve or reject crypto withdrawal requests.

## Local preview

```sh
npm ci
npm run build
npx wrangler dev --port 3011 \
  --var API_BASE_URL:http://127.0.0.1:18800 \
  --var UPSTREAM_ORIGIN:https://emiratesauction.jessicalopesboitamartins.workers.dev
```

`API_BASE_URL` must be HTTPS outside localhost. `INTERNAL_API_TOKEN` and `ADMIN_API_TOKEN` are stored only as Cloudflare Worker secrets and must match the VPS API. Staff login is delegated to the existing Urso administrative session endpoint for the allowlisted `gestao` and `operacoes` identities, so passwords are never copied into this repository or the browser bundle.
