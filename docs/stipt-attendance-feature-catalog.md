# Stipt.Cloud feature catalog

A complete audit of every user-facing and notable system feature of **Stipt.local**, with a per-feature verdict on its fate under **Stipt.Cloud**'s LTI 1.1 model: one Canvas assignment per course as the LTI resource link, single decimal grade per user via Basic Outcomes, course context provided by the launch.

The schema referenced throughout (`attendanceSessions`, `attendanceRecords`, `attendanceSections`, `enrollments`, `sessionAuditLog`, `recordAuditLog`, `deletionRequests`) comes from the draft DBML file `Stipt. Database Schema_2026-03-31T10_02_27.379Z.dbml`.

---

## 1. Executive summary

Stipt.local is a Flask + vanilla-JS desktop app, packaged as a PyInstaller `.exe` (or macOS `.app`) wrapped in pywebview, that lets a teacher run a single attendance session at a time against the Canvas LMS. Every session creates a fresh Canvas New Quiz, students authenticate to Canvas and submit the quiz with a 4-digit PIN gated by an IP filter, and the teacher scores them 0/1/2 in a live UI that immediately PUTs grades to Canvas. There is no local database. Settings live in a JSON file in the platform config dir and the Canvas API token is in the OS keyring; everything else is round-tripped through Canvas.

A high-level take on the feature inventory under LTI 1.1:

- **Roughly half of the catalog disappears.** Setup, course discovery (including iCal "today" suggestions), the New Quizzes creation dance, distribution/build, single-port single-instance constraints, and session-end's `lock_at` workaround all exist purely because Stipt.local lives outside Canvas. LTI launch + a Stipt.Cloud database make them unnecessary.
- **The core attendance UX survives largely unchanged.** The PIN, PIN rotation, the live student list with sort/search/score-cycling, the PiP window, the session timer — these are the actual domain logic of "running attendance" and they translate cleanly. The schema confirms this: `attendanceRecords.score smallint default 0` and `selfCheckIn` make the same model first-class.
- **A handful of features change shape, not status.** Settings, audit logging, submission-polling-with-auto-grade, and section selection all keep their purpose but get re-wired against the schema and LTI launch context.
- **A few new categories of work appear that Stipt.local doesn't touch at all.** Multi-teacher concurrency in a course, soft-delete + session restoration, GDPR-deferred deletion with `canvasUserID` nullification, two-table audit logging, and (most consequentially) **aggregating per-session attendance into a single Basic Outcomes decimal** — LTI 1.1 only allows one grade per user per resource link, so the per-session-per-Canvas-grade model Stipt.local relies on stops working entirely.

The biggest single risk is the aggregation rule. The biggest single design choice is the Canvas API token strategy for roster sync (LTI 1.1 has no NRPS). Both belong in section 6 as decisions the architect must make before code starts.

One discrepancy worth flagging up front: CLAUDE.md states that absent students are auto-graded zero by the server when a session ends. The code shows the **frontend** doing this, via per-user POSTs after a final submissions poll ([src/static/js/app.js:925-933](../src/static/js/app.js#L925)). Documentation rot. The schema makes both stories obsolete: `attendanceRecords.score` defaults to 0, so absence is the resting state.

---

## 2. Architecture overview of Stipt.local

### Stack

- **Backend**: Python 3.12, Flask. Single file: [src/app.py](../src/app.py) (~800 lines).
- **Frontend**: Vanilla JS SPA, hash-routed (`#screen-setup`, `#screen-courses`, `#screen-sections`, `#screen-session`). [src/static/js/app.js](../src/static/js/app.js) is ~1146 lines, monolithic. CSS in [src/static/css/app.css](../src/static/css/app.css) uses CSS custom properties for theming with a system-color-scheme follow.
- **Templates**: [src/templates/index.html](../src/templates/index.html) (main shell) plus partials in [src/templates/partials/](../src/templates/partials/) and a separate [src/templates/pip.html](../src/templates/pip.html) for the PIN-display window.
- **Native shell**: [pywebview](https://pywebview.flowrl.com/) when frozen by PyInstaller; otherwise a regular browser tab opened on startup ([src/app.py:767-803](../src/app.py#L767)).

### Distribution

PyInstaller builds, orchestrated by [src/build.py](../src/build.py): `--onefile` Windows `.exe`, `.app` bundle on macOS zipped to `.zip`. Versioning is in [src/version_info.txt](../src/version_info.txt) (Windows resource file with `filevers` / `prodvers` 4-tuples and matching `FileVersion` / `ProductVersion` strings). CI in [.github/workflows/build.yml](../.github/workflows/build.yml) is tag-triggered on `v*`; pushing a tag builds both platforms and creates a GitHub Release.

### Auth model

Single-user-per-machine. The Canvas API token is stored in the OS keyring (`keyring`, service name `"StiptLocal"`, [src/app.py:31](../src/app.py#L31), [src/app.py:98](../src/app.py#L98)). Anyone with access to the OS account can use the app. There is no LTI, no per-user identity, no central server. The teacher gets the token from Canvas → Account → Settings → New Access Token and pastes it into the setup screen; everything from there flows through that token.

### Data model

There is no database. State is in three places:

1. **In-memory dicts** at [src/app.py:131-145](../src/app.py#L131): `session_state` holds `quiz_assignment_id`, `quiz_id`, `course_id`, `current_pin`. `_pip_state` holds the PIN, countdown seconds, total seconds, session seconds, theme, and a `session_active` flag. Both are lost on app restart.
2. **Settings JSON** at `<platform-config-dir>/Stipt/settings.json` ([src/app.py:40-69](../src/app.py#L40)). Holds `canvas_base_url`, `ical_url`, `hidden_course_ids`, `session_duration`, `pin_duration`, `default_score`, `logging_enabled`. The Canvas API token is *not* in this file — it's in the OS keyring.
3. **Canvas as the system of record** for everything else: courses, sections, enrollments, the attendance assignment, submissions, grades.

This contrasts sharply with **Stipt.Cloud's** schema, which encodes:

- `attendanceSessions` (id, canvasCourseID, createdBy, durationMinutes, startedAt, closedAt, deletedAt) — sessions are first-class.
- `attendanceSections` (attendanceSessionID, canvasSectionID, deletedAt) — M:N join with its own soft-delete.
- `attendanceRecords` (id, attendanceSessionID, canvasUserID nullable, checkedInAt, selfCheckIn, score smallint default 0, scoredAt, deletedAt) — one row per student per session.
- `enrollments` (canvasUserID, canvasSectionID, canvasCourseID, syncedAt) — local Canvas roster cache, no FKs to anything (joined at query time), refreshed on `syncedAt` staleness.
- `sessionAuditLog` (id, attendanceSessionID, action, performedAt, performedBy) — session-level audit, actor stored.
- `recordAuditLog` (id, attendanceRecordID, action, performedAt, previousScore, newScore) — record-level audit. **No actor column** — a schema note says it's "derived from the related session's `createdBy` field."
- `deletionRequests` (id, canvasUserID, requestedAt) — GDPR queue, processing deferred until end of current academic year +1.

Schema characteristics that drive most translation calls in section 3:

- **`score` defaults to 0** → absence is the resting state; no end-of-session zero-flush needed.
- **`canvasUserID` nullable on records** → GDPR nullification preserves rows for institutional reporting without retaining identity.
- **`selfCheckIn` boolean** → student-driven check-in is first-class; teacher-only scoring becomes one mode, not the only mode.
- **No Canvas-assignment FK** → the LTI resource link is implicit. The LTI assignment exists in Canvas but Stipt.Cloud doesn't track its ID.
- **No tenancy column** → either Stipt.Cloud is single-institution-per-deployment, or tenanting is done above the schema.
- **No `defaultScore`, `pinDuration`, or `allowedIPs` columns** → those are session-creation parameters, institution-level config, or in-memory state, not stored alongside the data.

### External integrations

- **Canvas REST API**, mixing two flavours:
  - **New Quizzes** `/api/quiz/v1/courses/:id/quizzes` for quiz creation, item creation, and PIN updates. Quirks documented in [CLAUDE.md](../CLAUDE.md): no `assignment_id` returned, `published` not settable via PATCH.
  - **Classic Assignments** `/api/v1/courses/:id/assignments/...` for publishing, overrides, fetching submissions, and posting grades.
- **iCal feed** (optional). Pulls today's events from a teacher-configured URL, matches them to Canvas courses by name/code/word-overlap. Failures are silent.

### Scheduled jobs / background work

None server-side. The Flask app handles every request synchronously. Two client-side polls:

- The PiP window polls `/api/pip/state` every 500 ms ([src/templates/pip.html:62-96](../src/templates/pip.html#L62)) for live PIN, timer, and theme updates.
- The session screen rotates the PIN on a JS interval (default 30 s) and re-polls submissions on every rotation ([src/static/js/app.js:642-702](../src/static/js/app.js#L642)).

### Port binding

Hardcoded port 5050 ([src/app.py:771-778](../src/app.py#L771)). Bind failure surfaces a Dutch error and refuses to start, which means only one Stipt.local instance per machine.

---

## 3. Feature catalog

Each entry follows: **name + one-liner**, *User-facing*, *Mechanics*, *Why it exists*, *LTI translation*.

### Setup & configuration

#### Setup screen — first-run Canvas configuration

*User-facing*: A centered card on first launch asking for Canvas URL, API token, and an optional iCal URL. "Opslaan" navigates to the courses screen on success or shows an error banner on failure.

*Mechanics*: Rendered from [src/templates/partials/_screen_setup.html](../src/templates/partials/_screen_setup.html), wired up at [src/static/js/app.js:305-332](../src/static/js/app.js#L305). Submit POSTs to `/api/config` ([src/app.py:635-649](../src/app.py#L635)), which stores the token via `keyring.set_password()` and the URLs in `settings.json`. The router auto-redirects to the setup screen on load if `/api/config` GET returns `configured: false`.

*Why it exists*: Stipt.local has no central server and no LTI launch context, so the first-run flow has to bootstrap the Canvas API credentials from scratch. There is nowhere else for the token to come from.

*LTI translation*: **Disappears.** The institution admin installs the LTI tool in Canvas once, configuring the consumer key and shared secret in the tool's admin UI. Individual teachers never see a setup screen — they launch the tool from inside a course and they're in. The Canvas API token Stipt.local uses for *everything* is replaced by (a) the LTI launch's signed claims for identity, and (b) a server-side Canvas token strategy (open question, see section 6) for the roster API calls LTI 1.1 can't satisfy.

#### Token + identity validation via `/api/me`

*User-facing*: Invisible at the request level, but it gates two things: the setup screen treats a 401 as a bad token and shows an error, and the session screen displays the teacher's name from the same call.

*Mechanics*: GET `/api/me` ([src/app.py:617-623](../src/app.py#L617)) calls Canvas `/api/v1/users/self`. Frontend uses it at [src/static/js/app.js:543](../src/static/js/app.js#L543) when starting a session.

*Why it exists*: The token is opaque until you call something with it. Validating eagerly at setup-save means a wrong token surfaces on the same screen the user typed it on, not three screens later when they try to fetch courses.

*LTI translation*: **Disappears.** The LTI launch carries `lis_person_name_full`, `lis_person_contact_email_primary`, and `user_id` as signed claims; identity is established before the first byte of HTML is served. There's nothing left to validate and no teacher name to fetch separately.

#### Settings dialog — live edit of all the knobs

*User-facing*: A `<dialog>` modal opened from the topbar. Sections: Canvas (URL, token — blank means "leave unchanged"), Rooster (iCal URL), Sessie (session duration in minutes, PIN rotation in seconds, default score 0/1/2), Cursusfilter (per-course visibility checkboxes), Logboek (logging toggle + log file path). "Opslaan" applies live; the courses screen reloads if open.

*Mechanics*: [src/templates/partials/_screen_settings.html](../src/templates/partials/_screen_settings.html) for the markup. Read via GET `/api/settings`, write via POST `/api/settings` ([src/app.py:652-711](../src/app.py#L652)). The course filter list is fetched from `/api/all-courses` so previous-year courses can be shown alongside current-year ones for re-enabling.

*Why it exists*: A desktop tool needs settings somewhere; without a central server, it lives in a single dialog. The course filter exists specifically to clean up the courses screen when a teacher accumulates years of past Canvas enrollments.

*LTI translation*: **Changes shape**, splitting along three axes:
- **Canvas URL and API token** become institution-level admin config in the LTI tool's admin UI. Teachers don't see them.
- **iCal URL** disappears entirely (see "iCal today suggestions" below).
- **Session duration, PIN rotation, default score, course filter, logging toggle** become a teacher-profile (or per-session) parameter. Schema doesn't have a teacher-profile table drawn yet — open question. `durationMinutes` is per-session in the schema, so the "default duration" becomes a teacher preference applied at session creation, not a setting stored alongside the data.

#### Settings storage — platform config dir + OS keyring

*User-facing*: Invisible. The Logboek section of the settings dialog displays the path of the log file, which doubles as showing where the config dir is.

*Mechanics*: Settings JSON at `<platform-config-dir>/Stipt/settings.json` ([src/app.py:40-49](../src/app.py#L40)). Token at OS keyring service `"StiptLocal"`, key `"canvas_api_token"` ([src/app.py:31](../src/app.py#L31), [src/app.py:98](../src/app.py#L98)). Two one-time migrations run at startup:
1. **Settings JSON relocation** ([src/app.py:65-69](../src/app.py#L65)): if a `settings.json` exists next to the executable (legacy location), move it to the platform config dir.
2. **Keyring → settings.json** ([src/app.py:77-82](../src/app.py#L77)): pull `canvas_base_url` and `ical_url` from the keyring (where they used to live) and write them to `settings.json`.

*Why it exists*: PyInstaller `--onefile` extracts to a temp dir on each run, so anything next to the `.exe` doesn't survive. The platform config dir is the standard place. Both migrations exist because earlier versions made wrong calls — token-only-in-keyring, settings-next-to-exe — that have to be cleaned up on upgrade.

*LTI translation*: **Disappears.** Server-side state. Both migration paths become irrelevant — there are no users on a "previous Stipt.local install" because Stipt.Cloud is a different deployment.

### Course discovery

#### Teacher course list

*User-facing*: The courses screen shows a card per Canvas course the teacher is enrolled in as instructor or TA. Cards show name + course code; clicking selects the course and navigates to sections.

*Mechanics*: GET `/api/courses` ([src/app.py:214-224](../src/app.py#L214)) calls Canvas `/api/v1/courses?enrollment_type=teacher&state[]=available&per_page=100`. Pagination is handled by `canvas_get()` ([src/app.py:160-182](../src/app.py#L160)) which follows `Link: rel="next"`. Filters out `hidden_course_ids` from settings before returning.

*Why it exists*: Stipt.local has no inherent knowledge of which course the teacher is currently working in, so it has to enumerate every course they teach and let them pick.

*LTI translation*: **Disappears.** The LTI launch carries `context_id` (Canvas course ID) and `context_label` / `context_title`. The teacher launches Stipt.Cloud from inside the course they want — the courses screen has nothing left to do. The whole "pick a course" navigation step disappears.

#### Auto-hide-prior-academic-year courses

*User-facing*: Courses from prior academic years don't appear in the courses list by default. The teacher can re-enable them in the settings dialog under Cursusfilter.

*Mechanics*: At startup ([src/app.py:240-270](../src/app.py#L240)), every course's name is matched against regex `\b20\d{2}-\d{2}\b`. Anything that doesn't match the current academic year (computed `YYYY-YY` with a September boundary) is added to `hidden_course_ids`. Manually-hidden IDs are preserved across re-runs; only newly-detected old-year courses are added.

*Why it exists*: A teacher accumulates a long list of Canvas enrollments over years. Auto-hiding old years keeps the courses screen scannable. The regex is brittle (only works if courses are named with a year suffix) but works at this institution.

*LTI translation*: **Disappears.** The LTI launch already names the active course; there's no list to filter.

#### Manual course filter

*User-facing*: In the settings dialog, a checkbox per course. Unchecked courses don't appear on the courses screen.

*Mechanics*: `hidden_course_ids` array in `settings.json`. GET `/api/all-courses` ([src/app.py:227-237](../src/app.py#L227)) feeds the dialog with all courses (current and prior years, marked with an `is_current_year` flag). Saved hides apply immediately when the courses screen reloads.

*Why it exists*: Same reason as auto-hide — keeps the courses screen scannable. Manual override exists because the auto-hide regex isn't perfect.

*LTI translation*: **Disappears.** No list to filter.

#### Course search box

*User-facing*: A search input on the courses screen filters the card list live by name + course code.

*Mechanics*: Client-side filter at [src/static/js/app.js:419-430](../src/static/js/app.js#L419). Lowercase substring match. Hides the iCal-suggestions section when a query is active.

*Why it exists*: Even after auto-hide, a teacher with many courses still benefits from search.

*LTI translation*: **Disappears.** No list to search.

#### iCal "today" suggestions

*User-facing*: Above the full course list, a "Vandaag" section shows cards for courses the teacher is teaching today, sourced from a configured iCal URL. Cards are highlighted with the brand blue accent.

*Mechanics*: GET `/api/ical-suggestions` ([src/app.py:287-329](../src/app.py#L287)) fetches the iCal URL from settings (timeout 5 s), parses VEVENTs with `DTSTART` matching today, and matches each event's SUMMARY against Canvas courses by (a) name substring, (b) course-code substring, or (c) any 4-character-or-longer word from the summary appearing in the course name or code. Returns the matched courses.

*Why it exists*: Stipt.local has no inherent knowledge of which course a teacher is currently teaching. The iCal feed is how the tool answers "which session am I opening right now?" — it pulls the timetable from the institution's scheduling system into Stipt as a navigation aid.

*LTI translation*: **Disappears.** The LTI launch already tells Stipt.Cloud which course is active because the teacher launches from inside it. "Which session?" collapses to "is there one open for this course right now, and if not, want to open one?" The iCal feature has no replacement because there's nothing left for it to solve.

#### iCal URL configuration

*User-facing*: A field in the setup screen and the settings dialog labelled Rooster, where the teacher pastes their personal iCal feed URL from the institution's scheduling system.

*Mechanics*: Stored as `ical_url` in `settings.json`. Empty value disables the suggestions feature silently.

*Why it exists*: Personal preference per teacher; the institution doesn't expose a tool-friendly schedule API.

*LTI translation*: **Disappears** along with the suggestions feature it feeds.

### Section selection

#### Section list with enrollment counts

*User-facing*: After picking a course, a list of that course's sections appears as checkboxes, each annotated with its enrollment count. The Start button is disabled until at least one section is checked.

*Mechanics*: GET `/api/courses/:id/sections` ([src/app.py:332-338](../src/app.py#L332)) calls Canvas `/api/v1/courses/:id/sections?per_page=100`. Rendered via [src/templates/partials/_screen_sections.html](../src/templates/partials/_screen_sections.html) and [src/static/js/app.js:437-562](../src/static/js/app.js#L437). Items are keyboard-accessible (Enter/Space toggles the checkbox).

*Why it exists*: At this institution a Canvas course often has multiple parallel sections (group A, group B, lecture vs. exercise) that are taught at different times. The teacher running attendance is usually responsible for a subset, not all of them.

*LTI translation*: **Survives.** The schema's `attendanceSections` join makes multi-section per session first-class. Stipt.Cloud queries the same Canvas sections endpoint (or its `enrollments` cache filtered by `canvasCourseID`), and the teacher checks which ones this session covers. Works the same.

#### Multi-section selection / "toggle all"

*User-facing*: A "Toggle all" button checks or unchecks every section in one click.

*Mechanics*: [src/static/js/app.js:509-518](../src/static/js/app.js#L509). Pure client-side state mutation.

*Why it exists*: When a course has many sections and the teacher is running attendance for all of them (a plenary lecture), one click is faster than N.

*LTI translation*: **Survives.** Direct port.

### Session creation — the New Quizzes dance

#### Five-step Canvas-quiz creation

*User-facing*: Click Start on the sections screen. A spinner overlays the button. After 1–3 seconds the session screen opens with a freshly displayed PIN.

*Mechanics*: POST `/api/courses/:id/create_quiz` ([src/app.py:350-460](../src/app.py#L350)) executes five sequential Canvas API calls:
1. POST `/api/quiz/v1/courses/:id/quizzes` to create a New Quiz with `student_access_code` set to the PIN, `filter_ip_address: true`, and `filters.ips: [["193.191.137.192", "193.191.137.255"]]`. Quiz title is "Aanwezigheid YYYY-MM-DD HH:MM" or similar.
2. POST `/api/quiz/v1/courses/:id/quizzes/:quiz_id/items` to add a true/false confirmation question titled "Aanwezigheid bevestigen" with `points_possible: 2`. Without an item, students can't actually submit.
3. GET `/api/v1/courses/:id/assignments?search_term=<title>` to discover the `assignment_id` Canvas implicitly created. Picks the highest-ID match.
4. PUT `/api/v1/courses/:id/assignments/:assignment_id` to set `published: true`, `points_possible: 2`, and `only_visible_to_overrides: true` if any sections were selected. The classic Assignments API is used because New Quizzes' PATCH doesn't accept `published`.
5. For each selected section, POST `/api/v1/courses/:id/assignments/:assignment_id/overrides` with `{course_section_id: ...}`.

*Why it exists*: Each step compensates for a Canvas API quirk:
- Step 1 puts the PIN on a Canvas-grade-able artifact so submissions are auto-tracked.
- Step 2 exists because a New Quiz with no items can't be submitted.
- Step 3 is the workaround for "New Quizzes doesn't return `assignment_id`" — without it Stipt.local can't post grades, since grade endpoints are on the classic Assignments API.
- Step 4 publishes the assignment because New Quizzes PATCH won't.
- Step 5 enforces section-restricted access via classic overrides, since New Quizzes' built-in section assignment doesn't exist in this Canvas configuration.

*LTI translation*: **Disappears entirely.** Every step exists because Stipt.local needs a fresh Canvas-grade-able artifact per session. Stipt.Cloud has one persistent assignment per course (the LTI resource link configured by the institution), and session creation becomes `INSERT INTO attendanceSessions (canvasCourseID, createdBy, durationMinutes, startedAt) VALUES (...)` plus `INSERT INTO attendanceSections (...)` rows. No Canvas API call. Sessions become local to Stipt.Cloud; the Canvas assignment is only touched at grade-passback time via Basic Outcomes.

#### Hardcoded campus IP filter

*User-facing*: Invisible to the teacher. Visible to a student who tries to submit the quiz from off-campus: Canvas blocks them.

*Mechanics*: [src/app.py:371](../src/app.py#L371) hardcodes `[["193.191.137.192", "193.191.137.255"]]` — the Arteveldehogeschool campus subnet — into every quiz's `filters.ips` setting. Not configurable in the UI.

*Why it exists*: Defends against authenticated-but-not-physically-present check-ins. Without it, a student could share the PIN with a friend off-campus.

*LTI translation*: **Survives, repositioned.** Canvas New Quizzes' IP filtering is gone with the New Quizzes API itself. Stipt.Cloud must enforce the filter server-side at the check-in endpoint, comparing the requesting IP to an institution-level allow-list. The schema as drawn has no `allowedIPs` column anywhere — open question (section 6) on whether this is institution-level config, env-var-driven, or per-session override. The current `193.191.137.192/26` becomes one row in whatever institution-config table gets drawn.

#### Assignment-group lookup ("Aanwezigheden")

*User-facing*: Invisible. Required setup: the Canvas course must have an assignment group named "Aanwezigheden" (case-insensitive). If missing, session start fails with "Geen 'Aanwezigheden'-groep gevonden in deze cursus."

*Mechanics*: Before step 1 of the create-quiz flow, the frontend GETs `/api/courses/:id/assignment_groups` ([src/app.py:341-347](../src/app.py#L341), called at [src/static/js/app.js:535](../src/static/js/app.js#L535)) and finds the group whose name matches "aanwezigheden" lowercased. Its ID is passed as `assignment_group_id` in step 1 of quiz creation.

*Why it exists*: The institution wants attendance assignments segregated from graded course work in the gradebook. Pinning every session to a known group keeps gradebook columns organized.

*LTI translation*: **Disappears.** With one persistent LTI assignment per course (instead of one assignment per session), there's nothing to bucket. The LTI assignment lives wherever the institution admin places it in Canvas's gradebook structure at install time.

#### Assignment-ID-by-name search workaround

*User-facing*: Invisible.

*Mechanics*: [src/app.py:418-426](../src/app.py#L418). After New Quizzes creates a quiz (step 1), it returns the quiz UUID but not the Canvas `assignment_id`. Step 3 searches assignments by title, picks the one with the highest ID among matches, and uses that.

*Why it exists*: Pure New Quizzes API quirk. The classic Assignments API returns `assignment_id` directly; New Quizzes' equivalent endpoint doesn't include it in the response.

*LTI translation*: **Disappears.** No Canvas quiz created, no `assignment_id` to look up.

#### 4-digit PIN generation

*User-facing*: Generated client-side at session start; the result becomes the access code on the Canvas quiz and the number displayed on the teacher's screen.

*Mechanics*: [src/static/js/app.js:541](../src/static/js/app.js#L541) — `Math.floor(1000 + Math.random() * 9000).toString()`. No uniqueness or entropy guarantees. Sent to the backend as part of the create-quiz payload.

*Why it exists*: Gates check-in on physical presence — only people who can see the teacher's screen know the PIN.

*LTI translation*: **Survives.** Confirmed by the architect: Stipt.Cloud keeps the PIN as an in-room-presence anti-cheat layer alongside LTI launch authentication. Mechanism shifts from "Canvas access code on a quiz" to "ephemeral code Stipt.Cloud validates at its check-in endpoint." Storage location is an open question — schema has no PIN column, so it's likely in-memory state on the server, a separate cache (Redis), or a per-session column not yet drawn.

### Active session — student-facing anti-cheat

#### 4-digit PIN displayed on screen

*User-facing*: Four large monospaced digits in a panel at the top of the session screen, with an SVG ring counting down to the next rotation. Students see and type the same digits.

*Mechanics*: Rendered into 4 individual digit divs ([src/static/js/app.js:583-596](../src/static/js/app.js#L583)) so each digit can be styled independently. ARIA label announces the full PIN to screen readers.

*Why it exists*: Same as the PIN itself — physical-presence gating.

*LTI translation*: **Survives.** Direct port.

#### PIN rotation every N seconds

*User-facing*: The PIN changes automatically (default every 30 s, configurable 10–300 s in settings). The countdown ring shrinks and turns from green → orange → red as the rotation deadline approaches.

*Mechanics*: A JS interval at [src/static/js/app.js:642-673](../src/static/js/app.js#L642). On zero, calls PATCH `/api/quiz/:assignment_id/update_password` ([src/app.py:463-494](../src/app.py#L463)) which PATCHes the New Quizzes quiz with a new `student_access_code`. Updates `_pip_state["pin"]` so the PIP window picks up the new value on its next 500ms poll.

*Why it exists*: Even with a PIN, a fixed 4-digit code shared at the start of a 90-minute session is trivially shareable. Rotation makes the share-window short.

*LTI translation*: **Survives.** Mechanism changes: rotates a Stipt.Cloud-owned code, not a Canvas quiz access code via PATCH. Same UX, no Canvas round-trip — purely a database update plus push to any open PIP windows.

#### IP-range gate on student check-in

*User-facing*: Invisible to the teacher. Off-campus students who try to check in get an error.

*Mechanics*: Enforced today by Canvas New Quizzes via the `filters.ips` setting from quiz creation. Stipt.local does not implement IP filtering itself.

*Why it exists*: Belt-and-suspenders with the PIN. If a student shares the PIN, the recipient still has to be on-campus to use it.

*LTI translation*: **Survives, repositioned.** Stipt.Cloud's check-in endpoint reads the requesting IP (with proxy-aware unwrapping — `X-Forwarded-For` from a known proxy chain) and rejects requests outside the institution allow-list. Allow-list source is an open question.

### Active session — teacher-facing

#### PiP window for PIN display, three implementations

*User-facing*: A button next to the PIN panel pops the PIN out into a floating, always-on-top window so the teacher can keep it visible while presenting slides on the same screen.

*Mechanics*: [src/static/js/app.js:97-256](../src/static/js/app.js#L97) tries three paths in order:
1. **Document Picture-in-Picture** (HTML5 API): opens a 380×260 floating window styled via injected CSS ([src/static/js/app.js:107-157](../src/static/js/app.js#L107)). Renders the same digit + ring layout as the main panel.
2. **Native pywebview window**: when running as the frozen `.exe`, calls `window.pywebview.api.open_pip()` ([src/app.py:732-755](../src/app.py#L732)) which spawns a separate native window rendering [src/templates/pip.html](../src/templates/pip.html). The native window polls `/api/pip/state` every 500 ms ([src/templates/pip.html:62-96](../src/templates/pip.html#L62)) for live updates.
3. **In-page fallback dialog**: a `<dialog>` styled to look like a floating panel, used in browsers that don't support Document PiP and aren't the native shell.

*Why it exists*: Teachers run attendance while presenting. They need the PIN visible without alt-tabbing.

*LTI translation*: **Changes shape.** The native pywebview path dies with the rest of the desktop shell. Document PiP and the in-page fallback survive, but Stipt.Cloud runs inside Canvas's iframe — Document PiP from a cross-origin iframe is permitted only when the embedding page allows it via the `display-capture` permission policy. Expect Canvas behavior here to evolve; the fallback dialog becomes load-bearing rather than a last resort. Section 5 risk #7.

#### Theme — system color-scheme follow + cross-window sync

*User-facing*: The app respects the OS dark/light preference automatically and follows changes live (e.g., automatic transitions at sunset). Theme stays in sync between the main window, native PiP, and the Document PiP popup.

*Mechanics*: At [src/static/js/app.js:101-103](../src/static/js/app.js#L101): `matchMedia('(prefers-color-scheme: dark)')` on load and on `change`. `applyTheme()` sets `data-theme` on `<html>` and pushes the value to any open PiP windows ([src/static/js/app.js:78-89](../src/static/js/app.js#L78)). The native PiP picks it up via `_pip_state["theme"]` on its next poll.

*Why it exists*: The PIN panel is high-contrast and always-on-top. Mismatched theme between main window and PiP looks broken. System-follow means teachers don't have to flip a switch.

*LTI translation*: **Survives.** `prefers-color-scheme` works inside iframes; the cross-window sync narrows to "main + Document PiP" since native PiP is gone.

#### Live student list — sort, search, status badges, ±1 score buttons

*User-facing*: A table of every enrolled student (filtered to the selected sections), with columns for name, section, status badge (Afwezig/Aanwezig/Actief aanwezig in red/orange/green), and ± buttons to cycle through scores. Live search filters by name. Click column headers to sort by name (default) or status.

*Mechanics*: [src/static/js/app.js:740-816](../src/static/js/app.js#L740) renders. Enrollments come from GET `/api/courses/:id/enrollments?section_ids=...` ([src/app.py:589-614](../src/app.py#L589)) which calls Canvas `/api/v1/sections/:id/enrollments?type[]=StudentEnrollment` per selected section (CLAUDE.md note: not `/courses/:id/enrollments?section_id=` — that variant is broken at this institution) and deduplicates by `user_id`. Filter and sort run client-side on every render.

*Why it exists*: The core domain UI of "running attendance." Everything else exists to support this screen.

*LTI translation*: **Survives.** Stipt.Cloud renders the same UI sourced from the schema's `enrollments` cache filtered by `canvasCourseID` + selected `canvasSectionID`s, joined to `attendanceRecords` for the current session. No Canvas round-trip per render.

#### Score cycling 0/1/2 (Afwezig/Aanwezig/Actief aanwezig)

*User-facing*: ± buttons next to each student's row. Clicking + cycles 0 → 1 → 2; clicking − cycles back. Status badge updates immediately.

*Mechanics*: [src/static/js/app.js:809-830](../src/static/js/app.js#L809). On click, computes the new score in `[0, 1, 2]`, updates `state.attendance[user_id]`, and POSTs to `/api/session/grade` ([src/app.py:560-586](../src/app.py#L560)) with `{user_id, score, course_id, assignment_id}`. Backend immediately PUTs to Canvas `/api/v1/courses/:id/assignments/:assignment_id/submissions/:user_id` with `{submission: {posted_grade: str(score)}}`. Score mapping: 0=Afwezig, 1=Aanwezig, 2=Actief aanwezig.

*Why it exists*: 0/1/2 captures the institution's attendance grading: present-and-engaged earns more than just-here. The immediate Canvas round-trip means grades are durable even if the laptop crashes mid-session.

*LTI translation*: **Survives.** The mapping is unchanged; the schema's `score smallint default 0` stores the same values. Score writes go to `attendanceRecords` plus a row in `recordAuditLog`. Canvas grade-passback no longer fires per-write — it fires per Basic Outcomes recompute (whatever the aggregation rule decides — open question, section 6).

#### Submission polling — auto-grade students whose submissions arrive

*User-facing*: Students who submit the Canvas quiz automatically get a status badge update from "Afwezig" to "Aanwezig" without the teacher clicking anything.

*Mechanics*: `pollAndUpdateSubmissions()` at [src/static/js/app.js:676-702](../src/static/js/app.js#L676). Triggered on every PIN rotation and once on session end. Calls GET `/api/session/submissions`, finds students whose `workflow_state` shows a submission but whose local `attendance[user_id]` is below `defaultScore` (default 1), and POSTs `/api/session/grade` for each. The default score is configurable in settings.

*Why it exists*: Students are checking in via the Canvas quiz UI — the teacher shouldn't have to also click + on each one. The auto-bump ensures self-check-ins are credited without manual work.

*LTI translation*: **Changes shape.** The schema makes self-check-in first-class via `attendanceRecords.selfCheckIn = true`. Students no longer "submit a Canvas quiz" — they POST to a Stipt.Cloud check-in endpoint with the PIN; Stipt.Cloud validates the PIN, the IP, and the LTI launch session, and writes a record with `selfCheckIn = true`. The teacher's UI auto-updates from a websocket push or short poll. The score that a successful self-check-in produces is **not** in the schema (no `defaultScore` column) — open question whether it's a session-creation parameter, an institution-level rule, or hardcoded to 1.

#### Session timer countdown with color escalation

*User-facing*: A countdown in the top-right of the session screen, starting at the configured session duration (default 600 s = 10 min). Turns orange at ≤120 s, red at ≤60 s. At 0, calls `endSession()` automatically.

*Mechanics*: [src/static/js/app.js:617-640](../src/static/js/app.js#L617). Pure client-side interval. Synced to the PIP window's `session_seconds` for cross-window display.

*Why it exists*: A session has a finite check-in window. The timer makes the deadline visible to the teacher (and via PiP, optionally to the room).

*LTI translation*: **Survives.** Schema's `attendanceSessions.durationMinutes` stores the same concept. Server still computes `closedAt = startedAt + durationMinutes`; client still displays a countdown. Auto-end on timer expiry becomes a server-side scheduled close (or lazy-close-on-next-write), not a frontend timer race.

#### Status summary tally

*User-facing*: A bar above the student table showing counts: e.g., "12 actief, 18 aanwezig, 3 afwezig."

*Mechanics*: Computed from `state.attendance` on every render ([src/static/js/app.js:832-844](../src/static/js/app.js#L832)).

*Why it exists*: Quick at-a-glance pulse on the session.

*LTI translation*: **Survives.** Computed the same way from the records query.

### Session end

#### Best-effort end — `lock_at` workaround for unpublishing

*User-facing*: Teacher clicks "Beëindig sessie", confirms, sees a banner saying the session is ended and scores can still be edited.

*Mechanics*: POST `/api/session/end` ([src/app.py:497-540](../src/app.py#L497)). Fetches the assignment to get its current title, appends "(beëindigd HH:MM)", and PUTs `{name: <new>, lock_at: <now>}` to lock the assignment. Clears the in-memory `session_state` and sets `_pip_state["session_active"] = False`.

*Why it exists*: At this institution, Canvas is configured such that `published: false` is rejected for assignments that have submissions. `lock_at = now` is the only way to prevent late submissions. The title rename is purely cosmetic — it surfaces in Canvas's gradebook UI so the teacher can see at a glance which sessions have ended.

*LTI translation*: **Disappears.** No Canvas assignment to lock or rename. Session-end becomes `UPDATE attendanceSessions SET closedAt = NOW() WHERE id = :id` plus a `sessionAuditLog` insert with `action = 'closed'`. The Canvas LTI assignment stays untouched; only the aggregated grade gets recomputed and pushed via Basic Outcomes.

#### Frontend-driven flush of zero-grades for absent students

*User-facing*: When the teacher ends a session, every student who hasn't been marked otherwise gets an "Afwezig" badge and a Canvas grade of 0.

*Mechanics*: After the `/api/session/end` POST, [src/static/js/app.js:925-933](../src/static/js/app.js#L925) does a final submissions poll and then issues per-user POSTs to `/api/session/grade` for every student whose local attendance is still 0. **CLAUDE.md says this is automatic server-side; it is not — the frontend does it via a `Promise.allSettled` over individual POSTs.** Documentation rot.

*Why it exists*: Without an explicit zero-grade, Canvas treats no-submission students as "no grade" rather than "0", which messes up gradebook averages. The flush exists to force the zero.

*LTI translation*: **Disappears.** `attendanceRecords.score smallint not null default 0` makes "absent" the schema's resting state. When a session closes, students who were never written to simply have their existing `score = 0` rows. The aggregated Basic Outcomes recompute counts them. The flush was only needed because Stipt.local has no DB to default-zero into.

#### Inline confirmation dialog for session end

*User-facing*: Click "Beëindig sessie" → an inline red panel appears asking "Annuleer" or "Ja". No accidental ends.

*Mechanics*: A `.end-confirm` panel ([src/static/js/app.js:895-904](../src/static/js/app.js#L895)) toggles visible on click; "Ja" calls `endSession()`.

*Why it exists*: Ending a session is irreversible (in Stipt.local — no `deletedAt` to undo). The confirm prevents misclicks during a live class.

*LTI translation*: **Survives.** Confirms become softer in Stipt.Cloud because sessions can be soft-deleted and restored, but a confirmation prompt is still good UX. Direct port.

#### "Session ended" success banner + return-to-courses button

*User-facing*: After ending, the PIN panel and timer hide, a green banner says check-in is closed (with a note that scores can still be edited), and the end-session button changes to "Terug naar vakken."

*Mechanics*: [src/static/js/app.js:935-948](../src/static/js/app.js#L935). State flag `state.sessionEnded` gates the new behaviors.

*Why it exists*: Cleanly transitions the UI out of "live session" mode while preserving the score-editing capability.

*LTI translation*: **Survives.** "Terug naar vakken" disappears (no courses screen) and the button just navigates back to the post-launch session list. Otherwise unchanged.

#### Close-warning dialog mid-session

*User-facing*: If the teacher tries to close the native Stipt.local window while a session is active, a modal warning appears: "There's an active session. Are you sure?" Confirming ends the session and force-closes the window.

*Mechanics*: [src/templates/partials/_dialogs.html:2](../src/templates/partials/_dialogs.html#L2) defines a `<dialog id="close-warning-dialog">`. JS at [src/static/js/app.js:211-222](../src/static/js/app.js#L211) shows it, and on confirm calls `endSession()` then `window.pywebview.api.force_close()` ([src/app.py:732-760](../src/app.py#L732)) — the native window-close handler is intercepted by pywebview and routed through this confirmation.

*Why it exists*: Stipt.local has no server-side state. Closing the app mid-session loses session context — late check-ins can't be recorded, the absent-flush doesn't run, and any unsaved state in `session_state` evaporates. The warning gives the teacher a chance to bail out cleanly.

*LTI translation*: **Disappears.** Server-side state means closing the LTI tab loses nothing — the session is in `attendanceSessions` regardless. A `beforeunload` warning may survive as a courtesy ("you have unsaved changes" feel), but the underlying necessity is gone.

### Distribution & ops

#### pywebview native window vs. browser tab fallback

*User-facing*: Running the frozen `.exe` opens a native-feeling app window. Running `python src/app.py` from source opens a browser tab pointed at `http://localhost:5050`.

*Mechanics*: [src/app.py:767-803](../src/app.py#L767). When `sys.frozen` (PyInstaller) or `STIPT_WEBVIEW=1`, spawns a daemon Flask thread, waits for port 5050, then opens a pywebview window. Otherwise opens a browser tab with `webbrowser.open()` after a 1 s delay.

*Why it exists*: pywebview gives the desktop feel (icon in taskbar, no browser chrome) when distributed as an `.exe`. The browser path is for development.

*LTI translation*: **Disappears.** Stipt.Cloud is web-only. The whole native shell goes.

#### PyInstaller build pipeline

*User-facing*: Invisible. The teacher downloads a `.exe` (Windows) or a `.zip` (macOS) from GitHub Releases.

*Mechanics*: [src/build.py](../src/build.py) generates a `.spec` and runs PyInstaller with platform-specific flags: Windows `--onefile`, macOS `.app` bundle. CI in [.github/workflows/build.yml](../.github/workflows/build.yml) builds on tag push (`v*`) and uploads to a GitHub Release. The `.spec` file in the repo (`src/Stipt Local.spec`) is regenerated on every build and isn't actually used by CI.

*Why it exists*: Distribution model. Teachers don't run Python from source.

*LTI translation*: **Disappears.** Stipt.Cloud is deployed as a web service (Docker, Heroku, Kubernetes — whatever the architect picks), not a packaged binary.

#### `version_info.txt` 4-tuple Windows resource

*User-facing*: Shows up in the `.exe` file properties (Windows: right-click → Properties → Details).

*Mechanics*: [src/version_info.txt](../src/version_info.txt). Two tuples (`filevers`, `prodvers`) and two strings (`FileVersion`, `ProductVersion`) that must stay in sync. PyInstaller embeds these as a Windows version resource.

*Why it exists*: Standard Windows app metadata. Helpful for support diagnosing "which version is the user running?"

*LTI translation*: **Disappears.** Web app version is in the deployment, not the binary.

#### Single-port (5050), single-instance enforcement

*User-facing*: Trying to run two copies of the `.exe` on the same machine fails the second one with "Poort 5050 is bezet."

*Mechanics*: Hardcoded port at [src/app.py:717](../src/app.py#L717) and bind-failure handler at [src/app.py:771-778](../src/app.py#L771).

*Why it exists*: pywebview points at `http://localhost:5050` — a second instance would conflict and either fail to bind or end up serving the first instance's UI. Failing fast is better.

*LTI translation*: **Disappears.** Server-side, multi-instance is the norm and load-balanced.

#### Audit logging — opt-in, rotating local file

*User-facing*: A toggle in settings labelled "Logboek" enables logging. Path is shown next to the toggle so the user can find the file.

*Mechanics*: [src/app.py:102-129](../src/app.py#L102). When `logging_enabled = true`, every Canvas API call from `canvas_get()` and the explicit `_log_api()` calls in route handlers writes a line to `<config-dir>/Stipt/stipt.log`. `RotatingFileHandler` with 5 MB max and 3 backups. Format: `TIMESTAMP | METHOD | URL | HTTP_STATUS | reason`. Includes Canvas user IDs in PUT-grade entries; does **not** include student names.

*Why it exists*: Debugging support. When grades land wrong, the log reconstructs what happened.

*LTI translation*: **Survives, transformed.** The schema makes audit **mandatory** and splits it into two tables:
- `sessionAuditLog` — session-level actions: created, closed, deleted, restored. Stores `performedAt` and `performedBy` (the actor).
- `recordAuditLog` — record-level actions: score updates, deletions. Stores `previousScore`, `newScore`, `performedAt`. **No actor column.** Schema note says actor is "derived from the related session's `createdBy`," which is fine if and only if record edits are constrained to the session creator. If admins or co-teachers can edit, the audit log loses fidelity. Flagged as risk #9.

### Vestigial / dead code

The catalog is supposed to flag these. None of them belong in Stipt.Cloud regardless of LTI:

- **Brand SVGs in `brand/`** — `stipt-mark.svg`, `stipt-mark-white.svg`, `stipt-wordmark.svg`, `stipt-wordmark-white.svg` are bundled by PyInstaller but never referenced in templates, JS, or CSS. Only `stipt.ico` is used (favicon route at [src/app.py:27-29](../src/app.py#L27) and the Windows `.exe` icon).
- **`src/Stipt Local.spec`** — `build.py` regenerates this on every build run, so the file checked into the repo is stale. CI doesn't read it. Safe to delete.
- **`/api/all-courses`** ([src/app.py:227-237](../src/app.py#L227)) — only consumed by the settings dialog's course-filter checkbox list. Redundant with `/api/courses` for any other consumer.
- **Overlapping `/api/config` and `/api/settings` POST endpoints** — both write `canvas_base_url` and `ical_url`. `/api/config` ([src/app.py:635-649](../src/app.py#L635)) is the legacy setup-screen endpoint; `/api/settings` ([src/app.py:657-711](../src/app.py#L657)) is the comprehensive newer one. Could be unified.
- **`_DEFAULT_SETTINGS["default_score"]`** ([src/app.py:59](../src/app.py#L59)) — loaded server-side but the value is only read by the frontend (for auto-grade-on-submission). The backend never branches on it.

---

## 4. Cross-cutting concerns

Each translated to LTI 1.1, anchored to schema columns where applicable.

### Auth

- **Stipt.local**: token in OS keyring, single-user-per-machine. The `keyring` library uses Windows Credential Manager / macOS Keychain / Linux SecretService. No central server, no per-user identity beyond the OS login.
- **Stipt.Cloud**: LTI launch (OAuth 1.0a signed POST from Canvas) provides identity (`user_id`, `lis_person_name_full`) and course context (`context_id`, `context_label`). The launch establishes a session in Stipt.Cloud (cookie-based or token-bound — open question). Canvas API still required for roster sync because LTI 1.1 has no NRPS; the schema commits to a local cache via `enrollments` (composite PK `canvasUserID + canvasSectionID`, with `syncedAt` driving the refresh strategy). The token strategy for that Canvas API access — institution-level developer key vs. per-teacher OAuth — is the largest auth design choice and is open in section 6.

### GDPR / retention

- **Stipt.local**: no local PII persistence beyond the optional log file (which contains user IDs but not names). Nothing meaningful to retain or delete.
- **Stipt.Cloud**: schema explicitly encodes the regime. The `deletionRequests` table queues GDPR Right-to-be-Forgotten requests; the schema note says processing is **deferred until the end of the current academic year +1**. When processed, `attendanceRecords.canvasUserID` is nullified (not deleted) so attendance counts survive for institutional reporting (compliance with the institution's pedagogical-records retention requirement) without retaining identity. Worth documenting that nullification was chosen over row-deletion specifically to preserve the count — an aggregate "8 students attended" stays accurate after one of them is forgotten.

### Audit logging

- **Stipt.local**: opt-in, rotating local file, captures Canvas API calls but not internal state changes.
- **Stipt.Cloud**: mandatory, two tables (`sessionAuditLog` for session-level events with actor, `recordAuditLog` for score changes without actor). The actor-derivation assumption in `recordAuditLog` (actor = parent session's `createdBy`) is fragile if subaccount admins or co-teachers can edit scores — flagged as risk #9.

### Multi-section

- **Stipt.local**: per-session via Canvas section overrides on the assignment. One assignment, N overrides.
- **Stipt.Cloud**: explicit M:N via `attendanceSections` (composite PK `attendanceSessionID + canvasSectionID`, with its own `deletedAt` so individual section associations can be soft-removed independently of the session). Same logical model, persisted instead of derived.

### Multi-teacher

- **Stipt.local**: implicitly impossible. One machine = one Stipt instance = one teacher. Two teachers running attendance for the same course require two separate Canvas quizzes, which Canvas allows but the gradebook gets confusing.
- **Stipt.Cloud**: first-class. `attendanceSessions.createdBy` records who opened the session, and the schema has no uniqueness constraint on `canvasCourseID` — multiple sessions per course (parallel sections taught by different teachers, or co-teaching) are supported by the schema. The behaviour decision — "is concurrent open allowed?" — is open in section 6, but the schema doesn't pre-decide it.

### Soft deletes + restoration

- **Stipt.local**: none. Sessions are ended-and-locked, never deleted; mistakes (a misclick on Beëindig sessie) are unrecoverable in Stipt.local but recoverable in Canvas (the teacher manually edits `lock_at`).
- **Stipt.Cloud**: `deletedAt timestamptz` on `attendanceSessions`, `attendanceSections`, `attendanceRecords`. The `sessionAuditLog` "restoration" action (mentioned in the schema note) implies sessions can be brought back. **Restoration has a knock-on effect on Basic Outcomes**: restored records change a user's aggregate, requiring a recompute and a Canvas grade-history audit entry. Flagged as risk #2.

### Tenancy

The schema has no tenant column anywhere. Either Stipt.Cloud is single-institution-per-deployment (one DB instance per institution), or tenanting is done above the schema (filtered by Canvas course IDs, which carry implicit institutional context through the LTI launch). Worth confirming explicitly — affects deployment topology and security model.

### Internationalization

UI is Dutch only. Strings are hardcoded in templates (`Geen vakken gevonden`, `Aanwezig`, `Beëindig sessie`) and JS. Stipt.Cloud at AHS specifically can stay Dutch-only without remorse; if the goal expands to multi-institution beyond Flanders, i18n is a not-yet-touched piece of work. Worth flagging as known-not-supported.

### Keyboard accessibility

Cards on the courses screen, section items on the sections screen, and sort headers on the session table all handle Enter and Space. ARIA labels on PIN digits, sort columns, status badges. No app-level keyboard shortcuts (no Cmd+S, no global hotkeys). Survives unchanged into Stipt.Cloud — the patterns transfer cleanly.

### Browser back-button mid-session

Hash routing means `history.back()` exits the session screen without ending the session — `state.quizAssignmentId` is preserved but the timers stop running. Coming back via forward-navigation re-renders but doesn't restart the polls, which is a quiet bug. Stipt.Cloud has to decide what back-navigation means: allowed mid-session (with proper state restoration), gated behind a confirmation, or blocked entirely.

---

## 5. LTI 1.1 risks and gotchas

Priority-ordered. Schema-anchored where applicable.

1. **Aggregation rule for per-session records → one Basic Outcomes decimal.** LTI 1.1's Basic Outcomes service supports a single decimal score per user per resource link. The schema stores raw `attendanceRecords.score` per session — the rule that produces the single Outcomes value lives in app code and is invisible at the schema level. Stipt.Cloud needs three things, all of which are open: (a) the formula (mean, attendance percentage, weighted by tier where 2 counts more than 1), (b) when recompute fires (every record write, batched, on session close), (c) idempotency for re-fires (because session restoration and GDPR nullification both trigger recomputes). Stipt.local sidesteps the entire problem by creating one Canvas assignment per session — each one its own gradebook column — but that doesn't work with the LTI resource-link model where there is only one assignment.

2. **Recompute triggered by session restoration.** The schema's `sessionAuditLog` mentions a "restoration" action, implying soft-deleted sessions can be brought back. Restoring a session retroactively adds records to a user's aggregate; the Outcomes value for every affected user must be recomputed and pushed via Basic Outcomes. Canvas's grade history audit will see the change as a fresh grade post, which can confuse teachers reviewing gradebook history. Stipt.local has no analogue to this scenario.

3. **GDPR-nullified records and aggregation arithmetic.** Once `attendanceRecords.canvasUserID` is nullified post-deletion-request, those records are orphaned: they still exist (for institutional reporting) but no longer belong to a user. Aggregation logic must (a) skip nullified rows when computing per-user grades and (b) **not** post a regressing grade to Canvas for a deleted user (Canvas may still hold the user record). The schema preserves the row deliberately; aggregation code has to respect the new identity vacuum.

4. **Token strategy for Canvas API beyond LTI launch.** LTI 1.1 has no NRPS, and the schema commits to a local roster cache (`enrollments`). That means Stipt.Cloud needs a Canvas API credential to populate and refresh the cache. Two paths: (a) **institution-level developer key** — one credential, broad scope, easy to use, audit-log doesn't say which teacher triggered the call; or (b) **per-teacher OAuth** — more secure, audit-log is rich, but requires a one-time consent ceremony per teacher and token-refresh handling. The biggest auth design choice in the project; punting it picks itself in the wrong direction.

5. **OAuth 1.0a signing on every launch and every Outcomes call.** The signing spec is well-trodden but the canonical first-month-in-production fire is: HMAC-SHA1 mismatches caused by reverse-proxy header rewriting, Unicode normalization differences in student names containing apostrophes (`O'Sullivan` is one of the worst offenders), clock skew above the 5-minute window, or percent-encoding ambiguity in URL parameters. Every Basic Outcomes call to Canvas also signs, so every grade post is exposed to the same failure mode. Plan for early-stage logging that captures the canonical request string Stipt.Cloud signed alongside Canvas's response, so signature mismatches are debuggable.

6. **No deep linking in LTI 1.1.** Each course gets one assignment-launch URL per resource. "Session #3 of this course" is invisible to Canvas — the teacher has to launch the assignment, then navigate inside Stipt.Cloud to find the session they want. The session list lives entirely inside the tool, post-launch. The schema supports this with the `idx_attendanceSessions_canvasCourseID` index; the UX has to absorb the navigation layer that Canvas's deep linking would otherwise provide for free in LTI 1.3.

7. **Document PiP inside the LTI iframe.** The teacher screen runs inside Canvas's iframe. Document Picture-in-Picture from a cross-origin iframe is permitted only when the embedding page allows it via `Permissions-Policy: display-capture` (or its successor). Canvas's policy may not currently allow this, and may evolve. The fallback dialog Stipt.local already implements becomes load-bearing rather than a third-tier path.

8. **The campus IP filter without a schema home.** Stipt.local outsources to Canvas's New Quizzes feature. Stipt.Cloud must implement it server-side at the check-in endpoint. The schema as drawn has no `allowedIPs` column anywhere, implying this is institution-level config that hasn't been schematized yet, or a per-deployment env var. Confirm and capture in section 6.

9. **Audit-log actor fidelity.** `recordAuditLog` infers the actor of a score change from the parent session's `createdBy`. If a subaccount admin (per the schema note) or a co-teacher edits a record on behalf of the session creator, the audit log will misattribute to the creator. Either constrain record edits to `createdBy` only (simpler, more restrictive), or add an `actor` column to `recordAuditLog` (more flexible, requires schema change).

10. **Late check-ins after `closedAt`.** The schema's `attendanceSessions.closedAt` doesn't enforce a hard cutoff on writes — it's just a timestamp. A late student check-in arriving after `closedAt` is technically possible to record at the schema level. Behaviour decision: silently accept (and trigger a recompute of the aggregated grade), reject with an error, or accept-but-mark-late (e.g., a separate `lateCheckIn` boolean not yet in the schema). Worth deciding before writing the check-in endpoint.

11. **LTI launch user-id → schema's `canvasUserID` mapping.** LTI 1.1 launch params include `user_id` (the LMS-internal user ID — for Canvas, this is the Canvas user ID, a `bigint`) and `lis_person_sourcedid` (the SIS ID, often a string). The schema's `canvasUserID bigint` must be sourced from the `user_id` claim, not `lis_person_sourcedid`. Easy to get wrong if the LTI tool's Canvas configuration emits SIS IDs by default. Test with a known Canvas user ID before trusting the mapping.

12. **Iframe cookies and Storage Access API.** Stipt.Cloud's iframe inside Canvas needs to maintain its own session post-LTI-launch, which requires cookies. Chrome's third-party-cookie deprecation forces `SameSite=None; Secure` cookies, plus the Storage Access API (`document.requestStorageAccess()`) for Chrome's deprecation-grace period and post-deprecation. If neither lands, fall back to launch-token-in-URL on every navigation. Production-fire risk that's invisible in development because dev environments often run on the same origin as the LMS.

---

## 6. Open questions for the architect

Decisions the codebase and the schema together don't make — each blocks or shapes implementation work. Listed in approximate order of leverage (most-impactful first).

- **Aggregation rule.** What formula maps `attendanceRecords.score` rows to a single Basic Outcomes decimal? Mean of session scores? Attendance percentage (sessions where score ≥ 1, divided by total)? Weighted (where actief-aanwezig 2 counts 1.5× a regular 1)? When does it fire — per-record write, batched, on session close? Idempotent under restoration and nullification?
- **Token strategy for Canvas API.** Institution-level developer key (one credential) vs. per-teacher OAuth (one consent per teacher) for the calls driving `enrollments` syncs. Hybrid possible — install-time institution key for bootstrap, per-teacher OAuth for active edits.
- **Self-check-in score.** The schema has `selfCheckIn` boolean but no `defaultScore` column. What score does a successful self-check-in produce — 1, 2, configurable per session at creation, configurable per institution? Where does the configuration live if it's not in the data tables?
- **Tenancy.** No tenant column in the schema. Single-institution-per-deployment, DB-per-institution multi-tenancy, or implicit-via-Canvas-course-ID (which embeds institutional context through the LTI launch)? Affects deployment topology.
- **Multi-teacher concurrency policy.** The schema permits multiple `attendanceSessions` with the same `canvasCourseID` open at the same time. Is this intentional (parallel-section co-teaching is the use case) or should app code reject creation if an open session already exists? If allowed, how does the student UI disambiguate when launching as a student?
- **Authorization model.** Who can soft-delete a session? Just the `createdBy` teacher? Subaccount admins (per the schema note)? Course-level admins via Canvas roles? Determines the role check on every mutate endpoint.
- **`sessionAuditLog.action` and `recordAuditLog.action` enum values.** The schema uses `varchar(255)` — open vocabulary. Likely candidates: `created`, `closed`, `deleted`, `restored` for session; `scored`, `deleted`, `restored` for record. Pinning the closed set early stops drift across the codebase.
- **Soft-delete propagation.** When `attendanceSessions.deletedAt` is set, are child `attendanceRecords` and `attendanceSections` also soft-deleted (with their own `deletedAt`), or do queries need to filter on the parent's `deletedAt`? If only the parent is marked, every child query is one footgun away. Conversely, if `attendanceSections.deletedAt` is set on a single section join, what happens to that section's records — orphaned, soft-deleted in turn, or kept under the session?
- **Restoration semantics.** When a soft-deleted session is restored, does its existing `attendanceRecords` come back unchanged? If a record was edited via Canvas's gradebook in the interim, what wins? Does the Basic Outcomes recompute fire automatically?
- **PIN management.** The schema has no PIN column. In-memory only on the application server (loses sessions on restart)? Separate cache (Redis)? Per-session DB column not yet drawn?
- **IP allow-list location.** No column for it in the schema. Institution-level config table not yet drawn, env var per deployment, or per-session override at session creation?
- **Late check-in window.** Should Stipt.Cloud accept check-ins after `attendanceSessions.closedAt`? Reject with an error, accept and mark `lateCheckIn = true` (new column), or accept silently?
- **Audit actor for record edits.** Either constrain record edits to `attendanceSessions.createdBy` only, or add a `performedBy` column to `recordAuditLog`. The schema as drawn assumes the former; if any UX wants the latter, this is a schema change.
- **Pre-creation of records.** The schema permits an `attendanceRecords` row without `checkedInAt` (nullable) — i.e., a student who never checked in. Does Stipt.Cloud pre-create one row per enrolled student at session start (mass insert from `enrollments`), or lazily on first check-in / score? Affects the meaning of "absent default": pre-create makes "no row" impossible for an enrolled student; lazy makes "no row" mean "absent." Either works, but the aggregation rule has to know which.
