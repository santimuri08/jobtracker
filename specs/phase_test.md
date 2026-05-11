# Phase Test — Manual Walkthrough

## What this is

A click-by-click test of the entire JobAgent website. You'll sit at your computer, follow these steps in order, and at the end you'll know every feature works (or you'll know exactly which one doesn't).

Two parts:

1. **Backend smoke check** (~2 minutes) — make sure the API is alive before you bother with the UI.
2. **User walkthrough** (~45 minutes) — sign up, try chat, try the dashboard, try every AI feature, both as a chat command AND as a dashboard click. Confirm they do the same thing.

Each step has a ✅ pass condition. If something fails, write it down and keep going — you want the full picture before debugging.

What you need before starting:
- Chrome (not Safari — Phase 4 found extension hydration issues)
- A real PDF resume (any one-pager will do)
- Access to the Gmail account you signed up to Resend with (for the email test)
- A second browser profile or incognito window for the second-user test
- A terminal open on the repo root for the backend checks

Have fun. Take notes. Total time ≈ 45–60 minutes. Total Anthropic spend ≈ $0.40.

---

## Part 1 — Backend smoke check (do this first)

If any of these fail, stop. The UI test won't tell you anything useful until the backend is alive.

### Step 1.1 — Containers are up

    docker compose ps

✅ Pass: `db` shows `(healthy)` and `backend` shows `Up X minutes`.
❌ If down: `docker compose up -d`, wait 10 seconds, re-run.

### Step 1.2 — Database has every table

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "\dt"

✅ Pass: you see at least these tables:
- `users`, `accounts`, `sessions`, `verification_tokens` (Prisma auth)
- `applications`, `interview_rounds`, `contacts`, `notes` (Phase 2)
- `resumes`, `resume_parses` (Phases 2 + 3)
- `gap_analyses` (Phase 4)
- `cover_letters` (Phase 5)
- `email_preferences`, `scheduled_job_runs` (Phase 7)

❌ If missing tables: Phase 3 recovery sequence:

    cd frontend && npx prisma migrate reset --force --skip-seed && cd ..
    docker compose exec backend alembic upgrade head

### Step 1.3 — Health endpoint responds

    curl -s http://localhost:8000/api/v1/health

✅ Pass: returns `{"status":"ok","service":"jobtrackr-backend"}`.

### Step 1.4 — All required keys are set

    docker compose exec backend python -c "
    from app.config import settings
    print('JWT:      ', bool(settings.jwt_secret))
    print('Anthropic:', bool(settings.anthropic_api_key))
    print('Resend:   ', bool(settings.resend_api_key))
    "

✅ Pass: all three say `True`. Anthropic powers the chat agent + every AI feature; Resend powers the weekly email; JWT signs sessions.

### Step 1.5 — Backend pytest is green

    docker compose exec backend pytest -v 2>&1 | tail -5

✅ Pass: ends with `22 passed` (or higher).

### Step 1.6 — Frontend compiles

In a second terminal:

    cd frontend && npm run dev

✅ Pass: shows `Ready in Xs` and `http://localhost:3000` is listed. No red errors.

---

If all 6 steps passed, the backend and frontend are alive. **Move to Part 2.**

---

## Part 2 — User walkthrough

You'll do this as a brand-new user. Treat it like a usability test on yourself.

### Section A — First visit & sign-up

#### Step A.1 — Land on the homepage

Open Chrome → `http://localhost:3000`.

✅ Pass:
- You see the orb floating in the middle
- "Track. Apply. Land it." headline below it
- A composer (the text input box) below the headline
- 3 suggestion chips below the composer
- The top-right of the floating nav shows a blue **Sign in** button + a hamburger (☰)
- "Press Enter to launch the workspace." hint under the composer

#### Step A.2 — The composer is gated for guests

Type anything into the composer (e.g. "hi"). Press Enter.

✅ Pass: you get redirected to `/signup?from=/chat&q=hi`. The site doesn't open the workspace for a logged-out user — it asks you to sign up first.

#### Step A.3 — Sign up

You're on `/signup`. Fill in:
- Email: `[email protected]`
- Password: `testtest1` (any 8+ chars)

Click **Sign up**.

✅ Pass:
- You get redirected to the landing page (or `/chat` if `q=` was passed through)
- The hello tagline now says "Welcome back, alice" (instead of the anonymous tagline)
- The top-right of the nav now shows: avatar dot with `A` + your email + a Sign out icon
- The hamburger menu (☰) now has these items: Chat / Dashboard / Settings / How JobAgent Works

**Verify in the database** (in your terminal):

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT id, email FROM users;"

✅ Pass: 1 row with your email.

#### Step A.4 — Sign out and sign back in

Click the **Sign out** icon in the top nav. ✅ Pass: redirected to landing, tagline goes back to "An AI-native operating system…", top-right shows the **Sign in** pill again.

Click **Sign in** → enter your credentials → submit.

✅ Pass: logged back in, identity pill returns.

---

### Section B — Chat: the conversational workspace

This is the load-bearing section. Everything you do through chat should also work through the dashboard, and the database should be in the same state either way.

#### Step B.1 — Click a suggestion chip

Logged in, back on the landing page. Click any suggestion chip (e.g. "What's my pipeline look like?").

✅ Pass:
- Browser navigates to `/chat?q=...&new=1`
- The workspace shell renders: sidebar on the left, conversation area in the middle, input bar pinned to the bottom
- Your message appears in the conversation
- A "thinking" indicator appears (three pulsing dots)
- Within ~5 seconds, the agent responds. Probably says something like "You don't have any applications yet — want to add one?"

✅ Pass: the sidebar's "Saved chats" section now shows this conversation at the top, with a derived title.

#### Step B.2 — Add an application by chatting

In the input bar, type:

    I just applied to Stripe for Senior Backend Engineer, remote, 180-220k

Press Enter. Wait ~5 seconds.

✅ Pass:
- The agent's reply shows a pill labeled "Adding application"
- Below the pill, a result card appears with `Stripe` / `Senior Backend Engineer` / `applied` status
- The agent confirms in text ("Got it — added Stripe to your tracker." or similar)

**Verify in the database:**

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT company, role, status, salary_min, salary_max FROM applications;"

✅ Pass: one row, Stripe, Senior Backend Engineer, applied, 180000, 220000.

#### Step B.3 — Ask for your pipeline

Type: `What's my pipeline look like?`

✅ Pass: "Checking your pipeline" pill, then a card showing 6 status tiles + a total. `applied = 1`, `total = 1`, rest are 0.

#### Step B.4 — List your applications

Type: `Show me all my applications`

✅ Pass: "Looking up your applications" pill, then a card listing your Stripe entry with its status chip.

#### Step B.5 — Update a status

Type: `Change my Stripe application to interviewing`

✅ Pass:
- "Updating application" pill
- Result card shows Stripe with `interviewing` status
- Verify: `docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT status FROM applications;"` → `interviewing`

#### Step B.6 — Saved chats sidebar

Look at the sidebar. The chat you just had should be at the top of "Saved chats" with a title derived from your first message ("I just applied to Stripe…").

Click **+ New chat** at the top of the sidebar.

✅ Pass: the main conversation area clears. Sidebar still shows your previous chat in the list.

Type any quick message in the new chat (e.g. "hi"). Wait for the agent to reply.

✅ Pass: a second chat appears at the top of the sidebar.

Now click back on your **first** chat in the sidebar.

✅ Pass: the original Stripe conversation reloads, complete with all the tool pills and result cards.

#### Step B.7 — Persistence across reload

Hit Cmd+R to reload the page.

✅ Pass:
- The workspace doesn't dump you to an empty state
- Whichever chat you had open is still open
- The sidebar still has both chats
- All messages from both chats are intact

This is the localStorage persistence working. Verify in DevTools:
- F12 → Application tab → Local Storage → `http://localhost:3000`
- You should see a key `jobagent.chats.v1` with a JSON array of your chats

#### Step B.8 — Delete a saved chat

Hover over your "hi" test chat in the sidebar. A trash icon appears on the right.

Click it.

✅ Pass: the "hi" chat disappears from the sidebar. The Stripe chat remains.

#### Step B.9 — Visit /chat with nothing pending

Open a new browser tab. Go directly to `http://localhost:3000/chat`.

✅ Pass: the workspace auto-opens your most recent saved chat (Stripe). It does NOT show an empty stretched workspace.

Now click the Stripe chat's trash icon to delete it too. Then reload `/chat`.

✅ Pass: with no saved chats, `/chat` **redirects to `/`** — the landing page. The workspace only mounts when there's something to show.

This is the empty-state guard from the redesign.


---

### Section C — Dashboard: the structured view

Re-add the Stripe application so you have data to work with.

#### Step C.1 — Open the dashboard

From the landing page, hamburger menu → **Dashboard**. Or click the **Dashboard** item in the sidebar if you're in the workspace.

✅ Pass:
- The dashboard loads inside the same sidebar shell
- "Dashboard" headline at top with the subtitle "The structured view…"
- A blue "Talk to JobAgent" CTA card right below
- 6 status tiles + 1 total tile, mostly 0
- Filters row (search + status dropdown + sort dropdown)
- Resumes and Add application buttons
- An empty applications table with a hint "No applications yet. Try saying it instead."

#### Step C.2 — Add an application through the form

Click **Add application**.

Fill out the form at `/applications/new`:
- Company: `Figma`
- Role: `Frontend Engineer`
- Location: `Hybrid`
- Job URL: `https://figma.com/jobs/listing/fe`
- Job description: paste any 2-3 paragraph JD
- Salary min: `150000` / max: `190000`
- Status: `applied`
- Applied date: today
- Source: `Referral`
- Resume: leave blank for now

Submit.

✅ Pass: you land on `/applications/<id>` — the detail page — with all the fields visible.

#### Step C.3 — Edit the application

On the detail page:
- Change the status dropdown to `interviewing`.

✅ Pass: the status chip updates immediately.

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT company, status FROM applications;"

✅ Pass: Figma's status is `interviewing`.

#### Step C.4 — Add an interview round

On the same page, click **+ Add round**.

✅ Pass: a new "phone_screen" round shows up at position 1. Try changing the round type via the dropdown and confirm it persists across a page reload.

#### Step C.5 — Add a contact

Use the contact adder section:
- Name: `Sam Recruiter`
- Role: `Recruiting Lead`

Submit.

✅ Pass: the contact appears below the form.

#### Step C.6 — Add a note

Use the note adder textarea:

    Recruiter mentioned 2 rounds: tech screen + onsite

Submit.

✅ Pass: note appears with a timestamp.

#### Step C.7 — Back on dashboard, verify everything lines up

Click **Dashboard** in the sidebar.

✅ Pass:
- The Figma row appears in the applications table
- `interviewing` tile shows `1`
- `total` tile shows `1`

---

### Section D — Resumes

#### Step D.1 — Upload a resume

From the dashboard, click **Resumes** (the secondary button next to "Add application"). Or use the sidebar.

You're on `/resumes`.

- Click "Choose file" → pick any PDF
- Type a label: `My Main Resume`
- Click upload

✅ Pass: the resume appears in the list with its label and filename.

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT label, filename FROM resumes;"

✅ Pass: one row.

#### Step D.2 — Parse the resume

Click the resume row to open `/resumes/<id>`.

Click **Parse this resume**.

⏱ Wait 5–15 seconds. Watch the logs in your terminal:

    docker compose logs backend --tail=5 | grep "claude call"

✅ Pass: a line like `claude call model=claude-sonnet-4-5 in_tok=... out_tok=... cost_usd=... elapsed_ms=...` appears.

✅ Pass on the page:
- The button changes to "Re-parse"
- Cards render below: Contact (name, email), Summary, Skills (as chips), Experience (with bullets), Education

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT full_name, jsonb_array_length(skills::jsonb) AS n_skills FROM resume_parses;"

✅ Pass: name populated, at least 1 skill extracted.

#### Step D.3 — Link the resume to the Figma application

Go back to the Figma application detail page (`/applications/<id>` via the dashboard).

Currently there's no UI dropdown to set `resume_id` on an existing application (it's only on the create form). So either:

**Option A** — through the API. First grab your JWT from the DevTools console:

    await fetch('/api/auth/session').then(r => r.json()).then(s => console.log(s.backendToken))

Then:

    curl -X PATCH http://localhost:8000/api/v1/applications/<FIGMA_ID> \
      -H "Authorization: Bearer <YOUR_JWT>" \
      -H "Content-Type: application/json" \
      -d '{"resume_id": <RESUME_ID>}'

**Option B** — create a new application via the form with the resume selected from the dropdown at the bottom. Submit, then delete the old Figma row.

Either way works. ✅ Pass when:

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT company, resume_id FROM applications;"

shows `resume_id` is not null for Figma.

---

### Section E — AI features on the dashboard

These all live on `/applications/<id>`. Make sure you're on Figma's detail page (which now has both a JD and a linked resume).

#### Step E.1 — Gap analysis

Scroll to the **Gap analysis** card. Click **Run gap analysis**.

⏱ Wait 8–12 seconds.

✅ Pass:
- A big fit-score number renders (between 0–100)
- A summary paragraph below
- Green chips for matched skills
- Red chips for missing skills
- Bulleted experience gaps
- Bulleted recommendations

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT fit_score, summary FROM gap_analyses;"

✅ Pass: one row, fit_score populated.

Click **Re-run analysis**.

✅ Pass: a new analysis replaces the old one (don't append). Verify count is still 1:

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT COUNT(*) FROM gap_analyses;"

#### Step E.2 — Cover letter

Scroll to the cover-letter card.

- Tone: type `enthusiastic`
- Extra instructions: leave blank
- Click **Generate**

⏱ Wait 8–15 seconds.

✅ Pass:
- A "Draft 1" pill appears with a star ★ (active)
- The cover letter renders below — should reference Figma, frontend work, your actual resume content

Test the toolbar:
- **Copy** → open Notes or any text editor, paste, confirm it's the letter
- **Edit** → toggle into a textarea → change one sentence → **Save**
- Reload the page → ✅ the edit persists
- Click **Generate new draft** → ⏱ wait again → ✅ a "Draft 2" pill appears, but **Draft 1 stays active** (intentional — you only manually promote a new version)
- Click the Draft 2 pill → **Make active** → ✅ the star ★ moves to Draft 2
- Delete Draft 1 (with confirm prompt) → ✅ only Draft 2 remains

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT version_label, is_active FROM cover_letters;"

✅ Pass: one row, is_active=true.

#### Step E.3 — Bullet rewriter

Scroll to the bullet rewriter card.

Paste any resume bullet, e.g.: `Built a payment processing system that handled $2M in transactions`

Click **Rewrite**. ⏱ Wait 5–10 seconds.

✅ Pass: **three** variant cards render, labeled `IMPACT` / `CONCISE` / `ATS`. Each has the rewritten text + a rationale + a Copy button.

Click Copy on one variant → paste somewhere → ✅ correct text in clipboard.

Reload the page.

✅ Pass: the variants **disappear**. This is correct — bullet rewrites aren't persisted, by design. Confirm in DB:

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT to_regclass('bullet_rewrites');"

Should return `NULL` — no such table exists.

#### Step E.4 — Similar applications (only if Phase 6 was completed)

If your repo has `backend/app/routers/similar_applications.py`, you'll see a "Similar applications" card on the page. To test it usefully:

- Add 2 more applications via the dashboard, each with a different JD: e.g. Datadog (Senior Backend Engineer, Infra) and Notion (Frontend Engineer)
- On Figma's detail page, click **Find similar roles**

✅ Pass: Notion (also frontend) comes back near the top with similarity 60–85%; Datadog (backend) lower at 30–55%.

Logs should show `voyage embed model=voyage-3-large input_type=document chars=...` on each application save, but **not** when you ran the similar search (the search uses pgvector in Postgres, no external call).

If this card doesn't exist in your build → skip; that's the "Phase 6 cleanup" item from spec7.

---

### Section F — Chat does everything the dashboard does

Now the load-bearing test. Open `/chat` in a new tab.

#### Step F.1 — Run gap analysis by chat

Type: `Run a gap analysis on my Figma application`

✅ Pass: tool pill "Running gap analysis", card with fit score + everything else, just like the dashboard version.

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT COUNT(*), MAX(updated_at) FROM gap_analyses;"

✅ Pass: count is still 1 (re-running replaces the row), but `updated_at` just changed.

❓ If the agent says "I can't do that yet" → the tool isn't wired into `backend/app/routers/agent.py`. Acceptable; document it. Check `TOOLS` in that file.

#### Step F.2 — Generate a cover letter by chat

Type: `Draft a cover letter for the Figma role, enthusiastic tone`

✅ Pass: tool pill, card with the letter content.

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT COUNT(*) FROM cover_letters;"

✅ Pass: count incremented by 1.

Go back to the Figma detail page → ✅ the new draft appears in the cover-letter card.

#### Step F.3 — Rewrite a bullet by chat

Type: `Rewrite this bullet for the Figma role: "Built a payment processing system that handled $2M in transactions"`

✅ Pass: agent's reply includes the three variants (either as a card or formatted in text).

#### Step F.4 — Delete by chat

Type: `Delete my Figma application`

✅ Pass:
- Tool pill "Deleting application"
- Small confirmation card
- Verify: `docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT COUNT(*) FROM applications;"` → 0
- Open the dashboard → Figma is gone, all tiles back to 0

Cascade check — make sure rounds/contacts/notes/gap_analyses/cover_letters for Figma were all deleted:

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "
    SELECT 'rounds' AS t, COUNT(*) FROM interview_rounds
    UNION ALL SELECT 'contacts', COUNT(*) FROM contacts
    UNION ALL SELECT 'notes', COUNT(*) FROM notes
    UNION ALL SELECT 'gap_analyses', COUNT(*) FROM gap_analyses
    UNION ALL SELECT 'cover_letters', COUNT(*) FROM cover_letters
    UNION ALL SELECT 'resumes', COUNT(*) FROM resumes;
    "

✅ Pass:
- rounds, contacts, notes, gap_analyses, cover_letters all = 0 (cascaded)
- resumes still = 1 (resumes survive their linked application — intentional per Phase 2)


---

### Section G — Settings and weekly email

#### Step G.1 — Open settings

Click **Settings** in the sidebar.

✅ Pass: the settings page loads with sections for Account / Weekly summary email / Saved chats.

#### Step G.2 — Account section

✅ Pass: shows "Signed in as [email protected]" and a **Sign out** button.

#### Step G.3 — Email preferences: turn on

The weekly email card likely says "Off."

Click **Turn on**.

✅ Pass: card flips to "On — you'll get a recap every Monday."

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT user_id, frequency FROM email_preferences;"

✅ Pass: one row, frequency = `weekly`.

#### Step G.4 — Send a test email

Click **Send test now**.

⏱ Wait 30–60 seconds.

Watch logs:

    docker compose logs backend --tail=20 | grep -E "claude call|resend send"

✅ Pass: one `claude call` line + one `resend send` line.

Check your inbox (the email address you signed Resend up with).

✅ Pass: email arrives, with:
- A real subject line (not "Test email")
- "Hi alice," greeting
- 2–3 paragraph summary referencing your actual applications by name (if you re-added any after Section F)
- "Suggested next steps" with 2–3 bullets
- Footer with an unsubscribe link

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT last_sent_at FROM email_preferences;"

✅ Pass: timestamp is now-ish.

#### Step G.5 — Unsubscribe

Click the unsubscribe link in the email.

✅ Partial pass: the API call works (`SELECT frequency FROM email_preferences;` should now return `off`), but the user lands on a Next.js 404 page because the `/unsubscribe` frontend page isn't built yet. This is a known dormant item from spec7.

#### Step G.6 — Saved chats card

In the same settings page, scroll to the Saved chats card.

✅ Pass: shows "N conversations stored on this device."

Click **Clear all chats**.

✅ Pass:
- Button changes to "Tap again to confirm"
- Tap again → count goes to 0
- Open the sidebar → no saved chats

Note: this only clears localStorage. Your applications, resumes, gap analyses, cover letters are all untouched. Verify:

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "SELECT COUNT(*) FROM resumes;"

✅ Pass: still 1.

---

### Section H — Second user isolation

This proves the database properly separates two different users.

#### Step H.1 — Open a fresh browser profile

In Chrome: File → New Incognito Window. Or use a different browser entirely (Firefox, Safari).

The key is that localStorage and cookies should NOT be shared with Alice's session.

#### Step H.2 — Sign up as Bob

Go to `http://localhost:3000` → Sign in → Sign up.

- Email: `[email protected]`
- Password: `testtest1`

#### Step H.3 — Bob sees nothing

Open the dashboard.

✅ Pass:
- All 7 tiles show 0
- Applications table is empty
- "No applications yet. Try saying it instead."

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "
    SELECT u.email, COUNT(a.id) AS apps
    FROM users u
    LEFT JOIN applications a ON a.user_id = u.id
    GROUP BY u.email;
    "

✅ Pass: Alice has applications (or 0 after Section F's delete), Bob has 0.

#### Step H.4 — Bob can't see Alice's data via API

Grab Bob's JWT from DevTools console:

    await fetch('/api/auth/session').then(r => r.json()).then(s => console.log(s.backendToken))

In your terminal:

    # Find one of Alice's resume IDs
    docker compose exec db psql -U jobtrackr -d jobtrackr -c "
    SELECT id FROM resumes
    WHERE user_id = (SELECT id FROM users WHERE email='[email protected]')
    LIMIT 1;
    "

    # Try to read it as Bob
    curl -s -o /dev/null -w "%{http_code}\n" \
      -H "Authorization: Bearer <BOB_JWT>" \
      http://localhost:8000/api/v1/resumes/<ALICE_RESUME_ID>

✅ Pass: returns `404`. (Not 403 — the API deliberately returns 404 either when the resume doesn't exist OR when it belongs to someone else, so we don't leak existence.)

#### Step H.5 — Bob can use chat independently

In Bob's incognito window, open `/chat`.

✅ Pass: redirects to `/` (Bob has no saved chats, no `?q`, nothing to show — same empty-state guard).

Type from the landing composer: `I applied to OpenAI for ML engineer`

✅ Pass: agent adds it for Bob. Alice's dashboard (in your other window) does NOT show OpenAI.

    docker compose exec db psql -U jobtrackr -d jobtrackr -c "
    SELECT u.email, a.company
    FROM users u
    JOIN applications a ON a.user_id = u.id
    ORDER BY u.email, a.company;
    "

✅ Pass: each company is owned by the right user. Stripe/Figma/etc. → Alice. OpenAI → Bob.

---

## Final tally

Run through this list at the end. Each box should be a confident ✅.

### Backend
- [ ] Containers healthy
- [ ] All tables present
- [ ] Health endpoint responding
- [ ] Keys all set
- [ ] Pytest green
- [ ] Frontend compiles

### Sign-up & auth
- [ ] Can sign up
- [ ] Identity pill shows email after sign-in
- [ ] Sign out works
- [ ] Sign back in works
- [ ] Logged-out users can't open the workspace

### Chat
- [ ] Suggestion chip launches workspace
- [ ] Composer Enter launches workspace
- [ ] Agent adds applications via chat
- [ ] Agent shows pipeline summary
- [ ] Agent lists applications
- [ ] Agent updates statuses
- [ ] Agent deletes applications
- [ ] Sidebar saved-chats list updates live
- [ ] New chat button works
- [ ] Switching between saved chats works
- [ ] Page reload restores chat
- [ ] Trash icon deletes a chat
- [ ] /chat with no chats redirects to /
- [ ] /chat with chats auto-opens the most recent

### Dashboard
- [ ] Dashboard loads in the workspace shell
- [ ] Form adds applications
- [ ] Status dropdown updates
- [ ] Rounds add/delete
- [ ] Contacts add
- [ ] Notes add
- [ ] Table shows new applications
- [ ] Tiles count correctly
- [ ] Mobile cards render (resize browser narrow)

### Resumes
- [ ] Upload PDF works
- [ ] Parse extracts contact / skills / experience / education
- [ ] Can link resume to application (API or new-app form)
- [ ] Re-parse replaces, doesn't append

### AI features (dashboard)
- [ ] Gap analysis runs and renders
- [ ] Gap analysis re-run replaces row
- [ ] Cover letter generates
- [ ] Cover letter edit persists
- [ ] Cover letter draft pills work, ★ moves correctly
- [ ] Cover letter copy/delete works
- [ ] Bullet rewriter returns 3 variants
- [ ] Bullet rewriter copy works
- [ ] Bullet rewriter doesn't persist on reload
- [ ] (Optional) Similar applications ranks roles meaningfully

### AI features (chat)
- [ ] Gap analysis by chat works (or documented as not wired)
- [ ] Cover letter by chat works (or documented as not wired)
- [ ] Bullet rewriter by chat works (or documented as not wired)
- [ ] Chat delete cascades to all child rows

### Settings & email
- [ ] Settings page loads
- [ ] Account section shows email + sign out
- [ ] Email prefs toggle on/off
- [ ] Test email arrives
- [ ] Email content references real applications
- [ ] Unsubscribe link flips frequency (lands on 404 — known issue)
- [ ] Saved chats card shows count
- [ ] Clear all chats works

### User isolation
- [ ] Bob signed up successfully
- [ ] Bob's dashboard shows zero of Alice's data
- [ ] Bob's API calls return 404 for Alice's resources
- [ ] Bob can use chat independently
- [ ] Alice's data unchanged after Bob's activity

---

## What to do with the results

**If everything passed**: every feature in Phases 1–7 plus the redesign is working end-to-end. Date this run, commit a copy of the notes to your repo (e.g. `tests/manual/2026-05-11.md`), move on.

**If something failed**: write down which step number failed and what you saw. Three rules:

1. Don't try to fix it during the test. Finish the walkthrough first so you have the full picture.
2. Cross-check the failure with the relevant phase spec. Most failures are documented dormant items, not new bugs.
3. File one fix PR per failure, named after the phase that introduced the feature (e.g. "Phase 5 fix: cover letter edit not persisting").

**If you found yourself confused about how to do something** (not a bug — a UX gap): write that down too. That's where the next phase of design lives.

---

## How long should this take

- Part 1 (backend): 2–3 minutes
- Section A (sign-up): 3 minutes
- Section B (chat): 10 minutes
- Section C (dashboard CRUD): 8 minutes
- Section D (resumes): 5 minutes
- Section E (AI features on dashboard): 12 minutes
- Section F (chat parity): 8 minutes
- Section G (settings + email): 5 minutes
- Section H (second user): 5 minutes

**Total: 55–60 minutes**, plus ~$0.40 in Anthropic spend, well inside any free tier.

Do it once now. Then do it again every time you finish a phase, and you'll catch regressions before they ship.