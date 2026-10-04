# ML4T Recall

Next.js study interface for the bundled 928-question active ML4T pool. Active
questions, explanations, and answer keys live in `app/data/questions.json`;
withdrawn content is archived in `app/data/withdrawn-questions.json` for
historical exam reviews. Supabase stores authentication records, the code/key
catalog, answer attempts, exam sessions and drafts, private exam sampling/grading
metadata, and a legacy aggregate-progress baseline.

## Local setup

1. Install the pinned dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the Supabase project Connect
   dialog. Use an `sb_publishable_` key—never a service-role or `sb_secret_`
   key in a `NEXT_PUBLIC_` variable.
4. Set `NEXT_PUBLIC_SITE_URL=http://localhost:3000` and run `npm run dev`.

Unauthenticated study remains available and stores append-only answer attempts
under `ml4t-recall-answer-history-v2` in localStorage. An authenticated user
gets a user-scoped local cache plus batched, idempotent Supabase synchronization.
The older `ml4t-recall-progress-v1` cache is read as a legacy baseline so an
existing user's coverage and aggregate accuracy are not discarded.

## Supabase

The hosted project is **ML4T Recall** in the **ML4T** organization, deployed
in East US (North Virginia), project ref `dwwktivwkkcbjzqrrjdx`. Its public
API origin is `https://dwwktivwkkcbjzqrrjdx.supabase.co`; keep the actual
publishable key in `.env.local`/deployment settings rather than source control.

- `supabase/migrations` contains the schema, constraints, indexes, grants, and
  RLS policies.
- `user_question_attempts` stores each submitted five-statement answer or skip
  as a compact bit mask, score, source, skip flag, and timestamp. Skips complete
  the current session but do not affect accuracy or review scheduling. Attempts
  are immutable. Resetting study progress can delete ordinary attempts; linked
  exam attempts remain protected.
- `user_question_progress` is retained only to preserve aggregate progress from
  releases before answer history was introduced; new answers do not update it.
- `app/data/question-keys.json` is the immutable bundled code→`smallint`
  manifest; it contains no question content.
- Nine questions withdrawn on September 24, 2026, plus ML-D3G1Q6 withdrawn on
  October 1, 2026, are excluded from study and new exam sampling. Their stable
  keys and archived content remain available for existing progress and
  historical exam reviews.
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
configuration, set the Site URL to `https://www.ml4t.study` and allow
`https://www.ml4t.study/auth/callback`,
`https://ml4t.study/auth/callback`,
`https://www.ml4t.cards/auth/callback`,
`https://ml4t.cards/auth/callback`,
`https://ml4t-question-trainer.vercel.app/auth/callback`, and
`http://localhost:3000/auth/callback` as exact redirect URLs. Hosted Google
sign-in uses the **ML4T Recall Web** OAuth client in the `ml4t-recall` Google
Cloud project. Its redirect URI is
`https://dwwktivwkkcbjzqrrjdx.supabase.co/auth/v1/callback`. The client secret
is stored only in Google Cloud and Supabase's provider configuration—it must
never be added to this repository or a `NEXT_PUBLIC_` variable.

## Validation

```sh
npm run lint
npm run typecheck
npm run build
```

### Practice exams

The **Practice Exam** tab (`/practice-exam`) and exam details are public. Starting
an exam requires sign-in and a connection; ordinary Study practice remains available
anonymously. Sign-in returns to the originating tab and never starts the timer.
The destination travels in a short-lived, same-origin cookie, preserving the existing
exact `/auth/callback` redirect URLs for Google and magic-link sign-in.

Each server-created exam draws two questions from each of ten domains in both
knowledge areas, then shuffles the question and statement order. Its server-issued
90-minute deadline continues through navigation, refresh, connection loss, and
sign-out. Users can drag statements into True/False, or select a statement and then a
section heading using touch or a keyboard. Focused statements also support T/F/U
shortcuts. Users can pin questions and use the draggable calculator.

Persistence is split into:

- `user_exam_sessions`: owner, exam, start, deadline, submission time, and revision.
- `user_exam_questions`: question/order assignments, pins, and editable draft masks.
- `user_question_attempts`: the canonical finalized answers, `answered_mask`, scores,
  and `exam_session_id`. Unique session/question keys prevent duplicate attempts.

Only ownership-checked RPCs write exams. Finalization locks the session, grades all
40 questions against private pool keys, writes attempts, and clears draft answers
in one transaction. Final reviews use the attempt rows. Unanswered statements earn
zero points, including statements whose keyed answer is False. Exam attempts feed
existing learning progress and scheduling; **Reset progress preserves exam history**,
with that protection also enforced by RLS.

Browser autosaving stores an account-scoped snapshot and a durable edit queue before
network requests. Reconnection, focus, periodic retries, and reauthentication flush
pending changes. Persistent request IDs make retries safe after a lost response;
revision checks rebase pending field edits onto cloud state instead of replacing
whole questions. If two devices edit the same field, the later accepted edit wins.
A finalized exam cannot be overwritten: unsynced edits from another device are
retained in local recovery data, and the UI reports the conflict.

Expired sessions lock locally. Cloud finalization happens on the next authenticated
sync after all pre-deadline edits have been delivered, so an offline answer is not
silently discarded by a background timeout job. For this practice tool, delayed
edits carry their original client-recorded time, constrained to the exam window;
this is an offline-recovery design, not a proctored anti-tampering boundary.

An expired login does not unmount or erase the active exam. The originating account
must sign in again to sync; another account cannot upload its queue. Earlier v1
account-scoped local exams are imported idempotently and regraded on the server.
Legacy anonymous v1 data is left intact and is never silently assigned to an account.
Browser storage errors are visible; clearing browser data removes unsynced edits,
while synced history remains in Supabase.

Validation:

```sh
npm run test:exam
npm run lint
npm run typecheck
npm run build
# Transactional database integration tests; all fixtures are rolled back:
npx supabase db query --linked --file supabase/tests/practice_exam_sync_test.sql
```

### Practice sequencing and pool filters

Custom sessions and **Study 10 more** prioritize unseen questions, then due
mistakes, other missed questions, and mastered questions. **Review due** means the
latest answer scored below 5/5 and its retry date has arrived. A latest score of
5/5 stays **Mastered**, even after its stored review date passes.

In **Progress**, combine the exam, knowledge area, domain, status, and saved
filters before choosing **Practice**. Only matching questions enter the session,
up to 50 at a time. For unseen Exam 1 ML questions, choose **Exam 1**,
**Machine Learning**, and **Unseen**; optionally narrow to a single domain.
Run `npm run test:review` and `npm run test:pool` to check sequencing and filtering.

### Saved questions

Use **Save for review** during practice, an exam, or a submitted exam's answer review.
**Review → Saved questions** offers one pass through the saved collection. Correct
answers and session completion do not remove bookmarks; toggle **Saved for review**
to remove one. Exam pins remain separate reminders to revisit before submitting.

Signed-in bookmarks sync across devices. Signed-out bookmarks stay on the current
browser and are separate from account bookmarks. Offline changes are cached and
retried on reconnect, window focus, or **Retry bookmark sync**. Removals are retained
as tombstones; the newest edit wins (removal wins at equal timestamps).

Apply `supabase/migrations/20260924021554_saved_questions.sql` before deploying the
UI. It adds the bookmark table, ownership policies, and stale-update protection.
Run `npm run test:saved` and `supabase test db` to check persistence/conflicts and
row-level access respectively.
