# Research Tracker — Automation Setup

> ## ✅ ALREADY DONE (set up interactively on 18 Aug 2026)
>
> All under Google account **dhibinvikash1@gmail.com**:
>
> | Thing | Value |
> |---|---|
> | Cloud project (Gmail/OAuth) | `research-tracker-sync` |
> | Firebase project (database) | `research-tracker-sync-9a424` |
> | Firestore region | `asia-south1` (Mumbai) — **permanent** |
> | OAuth client | `research-tracker-cli`, redirect `http://localhost:5589` |
> | Consent screen | External · **In production** (7-day token trap avoided) |
> | Gmail API | Enabled |
> | Papers migrated | 45, from the old `r-tracker-e507e` |
> | Security rules | Published — public read, **all client writes denied** |
>
> Verified by attack test: read → 200, write → 403, delete → 403.
>
> **Remaining:** Steps 2 (professor's inbox), 3 (Firebase service-account key),
> 4 (GitHub secrets), 0 (push the code), 5 (link manuscript IDs).
>
> ⚠️ The OLD project `r-tracker-e507e` is still live, still world-writable, and
> nobody remembers which Google account owns it. Treat it as dead history.

Daily sync of journal correspondence from **two separate Gmail accounts** into one
dashboard, with manuscript timelines and deadline alerts.

**You do not merge the inboxes.** No forwarding, no POP import, no shared password.
The sync reads each account independently through the Gmail API and writes to one
database. Your professor's inbox stays exactly as it is; consolidation happens in
the *data*, not the email.

Budget about 45 minutes end to end. Steps 1–4 are one-time credential setup, step 5
is the part that actually determines whether this works.

---

## What runs where, and why

| Piece | Runs on | Why there |
|---|---|---|
| Daily sync | GitHub Actions | Needs internet access to Gmail + Firestore, secret storage, and a permanent run log |
| Deadline alerts | GitHub Actions | Same job, immediately after the sync |
| Dashboard | GitHub Pages | Unchanged from today |
| Data | Firebase Firestore | Unchanged from today |

An assistant sandbox cannot host this — its network is locked down and cannot reach
Firestore. GitHub Actions also gives you the audit trail that makes autonomous
updating defensible: every run is timestamped and inspectable in the Actions tab.

---

## What you need installed locally

Almost nothing. The design deliberately pushes everything onto GitHub Actions.

| Task | Runs where | Needs on your PC |
|---|---|---|
| Daily sync | GitHub Actions | nothing |
| Deadline alerts | GitHub Actions | nothing |
| Manuscript ID backfill | GitHub Actions | nothing |
| **Gmail authorisation** | **your machine** | **Node only** (no npm install) |
| Getting files into the repo | your machine *or* github.dev | Git, or a browser |

To get the code into the repo **without installing Git**: open
`https://github.com/DHIBIN-VIKASH/research-tracker`, press the **`.`** key.
That opens github.dev — a full VS Code in the browser. Drag the folders in from
Explorer, then use its Source Control panel to commit and push. Nothing to
install.

With Git (PowerShell): `winget install Git.Git`, then clone, copy, commit, push.

---

## Step 0 — Copy the files in

From the folder delivered to you, copy into your `research-tracker` repo:

```
firestore.rules                              (new — granular version; a simpler equivalent is already live)
src/firebase.js                              (replaces existing — points at the NEW project)
package.json                                 (replaces existing — adds deps + scripts)
index.html                                   (replaces existing — removes the hardcoded dark background)
src/App.jsx                                  (replaces existing — new dashboard)
src/index.css                                (replaces existing — light theme)
scripts/                                     (new — entire folder)
.github/workflows/                           (new — both workflow files)
```

Then:

```bash
git add -A
git commit -m "Add automated journal email sync, timelines and deadline alerts"
git push
```

You do **not** need to run `npm install` locally — GitHub Actions installs
dependencies itself on every run.

`src/firebase.js` is ALREADY updated to point at `research-tracker-sync-9a424`. `src/main.jsx` is unchanged.

---

## Step 1 — Google Cloud project (10 min, once for BOTH accounts)

One OAuth client serves both inboxes. Your professor does **not** need his own
Google Cloud project.

1. Go to <https://console.cloud.google.com> → **New Project** → name it
   `research-tracker-sync` → Create.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **Google Auth Platform → Audience** (older consoles: APIs & Services →
   OAuth consent screen):
   - User type: **External**
   - App name: `Research Tracker`, user support email: your address
   - Developer contact: your address → Save
   - **Data access** → Add or Remove Scopes → filter for `gmail.readonly` →
     select `.../auth/gmail.readonly` → Update → Save
   - **Publishing status → In production.** Click **Publish app** and confirm.
     ⚠️ **Do NOT leave this in "Testing".** See the warning below — this is the
     single most important setting on this page.
4. **Google Auth Platform → Clients** → **Create client**:
   - Application type: **Web application**
   - Name: `research-tracker-cli`
   - **Authorised redirect URIs** → **Add URI** → exactly:
     ```
     http://localhost:5589
     ```
   - Create → **copy the Client ID and Client Secret**.

> ### ⚠️ The 7-day refresh token trap — read this
>
> An **External** app whose publishing status is **Testing** issues refresh
> tokens that **expire after 7 days**. Adding accounts as *test users does not
> prevent this*. The only exemption is for apps requesting nothing beyond basic
> profile scopes (`userinfo.email`, `userinfo.profile`, `openid`), and
> `gmail.readonly` is well outside that.
>
> Left in Testing, your daily sync would die every week with `invalid_grant`
> and you would be re-authorising both inboxes forever.
>
> **Set publishing status to "In production".** You do NOT need to complete
> Google verification. The consequences of publishing unverified are:
>   · users see an "unverified app" warning at consent — click **Advanced →
>     Go to Research Tracker (unsafe)**. It is your own app.
>   · unverified apps requesting sensitive scopes are capped at **100 users for
>     the project's lifetime** (not resettable). You need two.
>
> The alternative, **Internal** user type, also avoids the 7-day expiry — but it
> requires a Google Workspace organisation and every user must belong to it.
> A professor on a different domain or a personal Gmail cannot consent to an
> Internal app, so External + In production is the right choice here.
>
> Sources: [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2),
> [Manage App Audience](https://support.google.com/cloud/answer/15549945)

> **Use a DEDICATED Google Cloud project** for this, not an existing one you use
> for other things. The consent screen's user type and publishing status apply to
> *every* OAuth client in the project, so flipping an existing project to
> External + Production changes the behaviour of anything else living there —
> and burns that project's one-time 100-user cap.

---

## Step 2 — Authorise both inboxes (5 min)

**This is the ONLY thing that has to run on a personal computer**, and it needs
**nothing installed except Node** — no npm, no `npm install`, no `node_modules`.
`get-refresh-token.mjs` is deliberately written with zero dependencies, using
only Node's built-in modules, so it can be copied anywhere and run on its own.

Why it can't run in the cloud: Google returns the authorisation code to
`http://localhost:5589`, and "localhost" means the machine whose browser you
clicked Allow in. A server elsewhere never receives it.

If Node isn't installed (Windows, PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS
```

Close and reopen the terminal afterwards so `node` is on the PATH. Verify with
`node --version`.

Then run it once for each account, on that person's own machine:

```powershell
node get-refresh-token.mjs
```

If you'd rather not be prompted, pass the values directly:

```powershell
node get-refresh-token.mjs --client-id "XXXX.apps.googleusercontent.com" --client-secret "GOCSPX-XXXX"
```

Paste the Client ID and Secret, then open the printed URL **in a browser signed
in as the account being authorised**. The script prints the mailbox address it
captured — check it matches before saving the token.

- Your inbox → token goes to secret `GMAIL_REFRESH_TOKEN_A`
- Professor's inbox → token goes to secret `GMAIL_REFRESH_TOKEN_B`

**What to tell your professor**, because "let a script read my email" deserves a
straight answer:

> It requests `gmail.readonly` only — Google enforces this, so it cannot send,
> delete or modify anything, and it can't touch any service other than Gmail.
> No password is shared; you sign in on Google's own page. You can revoke it in
> one click at myaccount.google.com → Security → Third-party apps with account
> access, without telling me.

"Google hasn't verified this app" is expected for a private app — click
**Advanced → Go to Research Tracker (unsafe)**. It's your own app; the warning
only means it was never submitted for public review.

---

## Step 3 — Firebase service account (5 min)

1. <https://console.firebase.google.com> → project **r-tracker-e507e**
2. ⚙️ **Project settings → Service accounts**
3. **Generate new private key** → downloads a JSON file
4. Open it, copy the **entire contents** (one long JSON blob)

That JSON is a full-access key to your database. Never commit it; it goes into a
GitHub secret only.

---

## Step 4 — Deadline alert email (5 min, optional but recommended)

Alerts send over Gmail SMTP with an **App Password** — deliberately a different
credential from the read-only OAuth token, so the sync literally cannot send mail
and the mailer literally cannot read your inbox.

1. Your Google account must have **2-Step Verification** on.
2. <https://myaccount.google.com/apppasswords> → create one named
   `research-tracker-alerts`
3. Copy the 16-character password (spaces don't matter).

---

## Step 5 — Add the GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `GMAIL_CLIENT_ID` | from Step 1 |
| `GMAIL_CLIENT_SECRET` | from Step 1 |
| `GMAIL_REFRESH_TOKEN_A` | your token, Step 2 |
| `GMAIL_REFRESH_TOKEN_B` | professor's token, Step 2 |
| `FIREBASE_SERVICE_ACCOUNT` | the whole JSON, Step 3 |
| `ALERT_SMTP_USER` | the Gmail address sending alerts |
| `ALERT_SMTP_PASS` | app password, Step 4 |
| `ALERT_RECIPIENTS` | `dhibinvikash1@gmail.com,professor@example.com` |

---

## Step 6 — Link manuscripts to papers ← **THE STEP THAT MATTERS**

Nothing auto-updates until each paper carries the manuscript ID the journal uses.
Matching is by ID only; the system will not guess from titles, because a fuzzy
title match is how a tracker silently records the wrong decision on the wrong paper.

**No terminal needed.** This runs on GitHub's servers using the secrets you
already added.

Repo → **Actions** → **Backfill Manuscript IDs** → **Run workflow**:

- `mode`: **report** (writes nothing)
- `months`: `12`, or `24` to look further back

Open the run log when it finishes.

It prints every manuscript ID it found — with the journal, the date range, the
subject lines and the latest detected status — next to your tracked papers. Match
them by eye; you know which paper went where. Create `mapping.json`:

```json
{
  "1": "ESJ-D-25-00112",
  "2": "ASJ-D-25-00901",
  "3": ["NC-25-1123", "JOSR-D-25-00417"]
}
```

Then run the same workflow again with `mode` = **write**, pasting that JSON into
the `mapping` box. (Local alternative, if you prefer a terminal:
`npm run backfill -- --write mapping.json`.)

Use an **array** when a paper was rejected by one journal and resubmitted to
another. **This is what keeps one manuscript on one timeline.** All the IDs point
at the same piece of work, so the history continues across venues instead of
restarting — the dashboard chapters it into numbered submission rounds
("Round 1: Spine → Rejected", "Round 2: European Spine Journal → Major revision")
with the resubmission transition marked between them.

When a paper moves journals later, add the new ID and the sync handles the rest:
it promotes the new ID to primary, keeps the old one as an alias, updates the
current journal, and records the transition. You'll see the new ID appear in
**Needs your eyes** first — that's the prompt to link it. Then:

```bash
npm run backfill -- --write mapping.json
```

A paper left unmapped simply never auto-updates; its emails go to the
**Needs your eyes** panel instead. Nothing breaks.

---

## Step 7 — First run (dry run first)

Repo → **Actions → Sync Research Tracker → Run workflow** →
tick **dry run**, set lookback `30d` → Run.

Open the log. It shows every classification without writing anything. Check the
decisions look right. Then run again with dry run **off**.

The schedule then fires daily at **02:30 UTC = 08:00 IST**.

Locally:

```bash
npm run sync:dry      # classify and report, write nothing
npm run sync          # live
npm run alerts:dry    # show which alerts would send
npm run test:classify # 35 adversarial classifier tests
```

Run `npm run test:classify` after editing any rule. It covers the cases that
break naive keyword matching — a rejection quoted inside a revision letter,
"accepted for review", reviewer invitations for other people's papers, and
threatened-vs-actual withdrawal.

---

## Step 8 — Close the open database ⚠️

**Do this. Your Firestore is currently writable by anyone on the internet.**

Your Firebase config sits in a public repo (normal for Firebase), but the app's
password screen is a browser-side `localStorage` check — cosmetic. Anyone who
reads your repo can take the config and read or **overwrite every paper record**
without ever loading your site.

Firebase console → **Firestore Database → Rules** → paste `firestore.rules` →
**Publish**.

**Trade-off:** browser writes stop, so the dashboard's add/edit/delete buttons stop
working. The sync is unaffected (the Admin SDK bypasses rules). Your options:

- **A (start here):** edit papers in the Firebase console. The sync handles status
  changes; you only touch it to add a paper or set a manuscript ID. Then set
  `READ_ONLY = true` at the top of `src/App.jsx` to hide the dead buttons.
- **B (best):** enable Firebase Authentication, add both of you as users, and
  switch to the commented-out `isEditor()` rules. Buttons work again, for you two
  only, enforced server-side. Ask me and I'll wire the login screen in.

Also consider: unpublished manuscript titles are visible to anyone with your
project ID under `allow read: if true`. If that matters, option B lets you close
reads too.

---

## How the safety model works

You chose full autonomy. Five mechanisms make that survivable:

1. **Idempotency** — every processed message ID is recorded; re-runs can't
   double-apply.
2. **Append-only history** — a status change never destroys the previous one.
   `statusHistory[]` keeps every transition with its source email.
3. **No guessing** — match by manuscript ID only. Unknown ID → queue, not guess.
4. **Ambiguity escalates** — if accept vs reject can't be separated confidently,
   it writes nothing and queues the email. Refusing is a valid answer.
5. **Regression guard** — a Published paper won't silently revert because an old
   email arrived late.

Anything the system won't decide lands in **Needs your eyes** on the dashboard,
with a link to the email.

---

## Deadline alerts

Deadlines are extracted from revision, proof and action-required emails — both
absolute ("by 15 September 2026") and relative ("within 60 days", anchored to the
email's receipt date, which is the case people miscalculate).

Alerts escalate: **14 → 7 → 3 → 1 → 0 days**, then once when overdue. Each rung
fires exactly once, so you don't get the same warning every morning for two weeks.
A new deadline resets the ladder.

This is the highest-value part of the system. Papers are rarely lost to bad
science; they're lost to a revision window that expired during a run of postings.

---

## Troubleshooting

**Everything lands in "Needs your eyes"** — no manuscript IDs mapped. Step 6.

**"invalid_grant" / auth failed** — token revoked or expired. Re-run `npm run auth`
for that account and update the secret. Check both accounts are Test users (Step 1.3).

**Scheduled workflow stopped firing** — GitHub disables schedules after 60 days of
repo inactivity. Push any commit, or trigger manually, to re-arm.

**A wrong status got written** — open the paper's timeline, click through to the
source email, and correct it in the Firebase console. The history entry stays as a
record of what happened; nothing is lost.

**Alerts not arriving** — check `ALERT_RECIPIENTS` is set and the app password is
current. `npm run alerts:dry` shows what would send without sending.

---

## What changed in the dashboard

- **Light theme** — white cards on a soft grey page, real borders instead of
  glow. Note: `index.html` had an inline `style="background:#020617"` on `<body>`
  that silently overrode any stylesheet; that's now removed. If the page ever
  reverts to dark, check there first.
- **Manuscript journey timeline** — a paper's full path across journals,
  rejections and revisions as ONE continuous story, chaptered into numbered
  submission rounds, every entry linked to its source email
- **Resubmission markers** — a "2 journals" chip on any paper with a
  multi-venue history, and a transition banner between rounds
- **Deadlines panel** at the top, sorted by urgency, with the sentence each
  deadline was read from
- **Needs your eyes** queue for anything the sync refused to decide
- **Stat tiles** — active, under review, needs action, overdue, due in 7 days,
  accepted, published
- **Pipeline view** — distribution across stages, plus a resubmission count
- **Sync freshness indicator** — warns if the job hasn't run in 48 hours, so a
  dead cron can't leave stale data looking current
- **Removed** the `/50` lifetime target bar
- Confidence shown per timeline entry; anything under 75% is flagged *verify*

### On the colour choices

Every status colour was checked, not eyeballed. At the obvious picks — a mid
green for Accepted, a mid red for Rejected — those two badges measure **ΔE 0.2
apart under deuteranopia**: identical for roughly 8% of men. Since accept-vs-
reject is the most consequential distinction on the page, the palette was rebuilt
around it. Published is **violet** rather than a second green, and Rejected is a
much darker red, so the pair differs in lightness as well as hue and survives
greyscale printing. On top of that every status carries its own **icon** and a
text label, so colour is never the only channel. All status text clears WCAG AA
(≥4.5:1) on both the card and page surfaces.
