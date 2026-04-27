# Stipt. Local

Local web app for teachers to track student attendance via Canvas LMS. A Flask server acts as a proxy — the Canvas API token never reaches the browser.

## Stack

- **Backend:** Python / Flask (`canvas-attendance/app.py`)
- **Frontend:** Single HTML file, inline CSS + JS (`canvas-attendance/templates/index.html`)
- **Distribution:** PyInstaller `--onefile` Windows exe (`python canvas-attendance/build.py`)

## Running locally

```bash
cd canvas-attendance
pip install -r requirements.txt
python app.py          # opens http://localhost:5050 automatically
```

On first run (no `.env`), the app shows a setup screen to enter Canvas credentials. These are saved to `.env` next to the running file.

## Canvas API notes

- Uses **New Quizzes** API (`/api/quiz/v1/...`) for quiz creation and access code updates, and the classic Assignments API (`/api/v1/...`) for publishing, overrides, grades, and enrollments.
- New Quizzes quiz creation does **not** return `assignment_id` — it must be looked up via `/api/v1/courses/:id/assignments?search_term=<title>`.
- `published` is not settable via New Quizzes PATCH — use the classic Assignments PUT instead.
- Section enrollments use `GET /api/v1/sections/:id/enrollments`, not `courses/:id/enrollments?section_id=`.
- Ending a session sets `lock_at` to now (not `published: false`) because unpublishing is not permitted in this Canvas setup.

## Score mapping

| Status | Points | `posted_grade` |
|---|---|---|
| Afwezig | 0 | 0 |
| Gedeeltelijk | 1 | 1 |
| Aanwezig | 2 | 2 |

Grade syncs to Canvas on every score change, and absent students receive grade 0 automatically when the session ends.

## Frontend architecture

Single-page app with hash-based routing (`#screen-setup`, `#screen-courses`, `#screen-sections`, `#screen-session`). All state lives in the `state` object. The PIN panel uses the Document Picture-in-Picture API (Chrome 116+).
