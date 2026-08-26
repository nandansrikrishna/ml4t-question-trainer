# ML4T Recall

Next.js study interface for the bundled 938-question ML4T pool. Questions,
statements, explanations, and answer keys remain in `app/data/questions.json`;
Supabase stores only authentication records, the tiny code/key catalog, and
aggregated study progress.

## Local setup

1. Install the pinned dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the Supabase project Connect
   dialog. Use an `sb_publishable_` key—never a service-role or `sb_secret_`
   key in a `NEXT_PUBLIC_` variable.
4. Set `NEXT_PUBLIC_SITE_URL=http://localhost:3000` and run `npm run dev`.

Unauthenticated study remains available and uses
`ml4t-recall-progress-v1` in localStorage. An authenticated user gets a
user-scoped local cache plus batched Supabase synchronization.

## Supabase

The hosted project is **ML4T Recall** in the **ML4T** organization, deployed
in East US (North Virginia), project ref `dwwktivwkkcbjzqrrjdx`. Its public
API origin is `https://dwwktivwkkcbjzqrrjdx.supabase.co`; keep the actual
publishable key in `.env.local`/deployment settings rather than source control.

- `supabase/migrations` contains the schema, constraints, indexes, grants, and
  RLS policies.
- `app/data/question-keys.json` is the immutable bundled code→`smallint`
  manifest; it contains no question content.
- `supabase/seed.sql` contains the same stable keys and question codes.
- `npm run catalog:seed` preserves every existing assignment and appends keys
  for new bundled questions. Ship future additions in a new migration after
  the current maximum key; never regenerate an already-applied migration.

For local Supabase development, install Docker and run:

```sh
npx supabase@2.115.0 start
npx supabase@2.115.0 db reset
```

Email magic links use `/auth/callback`. In the hosted Supabase Auth URL
configuration, allow both `http://localhost:3000/auth/callback` and the
production callback URL. Hosted Google sign-in uses the **ML4T Recall Web**
OAuth client in the `ml4t-recall` Google Cloud project. Its authorized origins
are `https://ml4t-question-trainer.vercel.app` and
`http://localhost:3000`; its redirect URI is
`https://dwwktivwkkcbjzqrrjdx.supabase.co/auth/v1/callback`. The client secret
is stored only in Google Cloud and Supabase's provider configuration—it must
never be added to this repository or a `NEXT_PUBLIC_` variable.

## Validation

```sh
npm run lint
npm run typecheck
npm run build
```
