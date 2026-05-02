# Stipt. Local

Local web app for teachers to track student attendance via Canvas LMS. A Flask server acts as a proxy — the Canvas API token never reaches the browser.

## Project structure

```
Stipt-local/
├── src/         # Application source (Flask app, templates, build scripts)
├── brand/       # Logos and branding assets (icon, etc.)
└── .github/     # CI/CD workflows
```

## Stack

- **Backend:** Python / Flask (`src/app.py`)
- **Frontend:** Two HTML templates — `src/templates/index.html` (main SPA) and `src/templates/pip.html` (PIN display window), both with inline CSS + JS
- **Distribution:** PyInstaller — Windows `--onefile` `.exe`, macOS `.app` bundle zipped as `.zip` (`python src/build.py`)

## Running locally

```bash
cd src
pip install -r requirements.txt
python app.py          # opens http://localhost:5050 automatically
```

On first run (no `.env`), the app shows a setup screen to enter Canvas credentials. These are saved to `.env` next to the running file.

## Versioning

Version is stored in `src/version_info.txt` — a PyInstaller Windows resource file. Two places must stay in sync when bumping:

```text
filevers=(1, 0, 0, 0)        # Windows 4-tuple
prodvers=(1, 0, 0, 0)
...
StringStruct(u'FileVersion',  u'1.0.0.0')
StringStruct(u'ProductVersion', u'1.0.0.0')
```

There is no `__version__` in Python code; `version_info.txt` is the single source of truth. The version is embedded in the Windows `.exe` properties only — it is not displayed in the UI.

### Releasing a new version

1. Edit `src/version_info.txt` — update both tuples and both strings.
2. Commit the change.
3. Push a git tag matching `v*` (e.g. `v1.1`).
4. GitHub Actions (`.github/workflows/build.yml`) detects the tag, builds Windows + macOS artifacts, and creates a GitHub Release automatically.

> **For future agents:** bump the version in `version_info.txt` whenever you make a change that warrants a release — patch for bug fixes, minor for new features, major for breaking changes. Use the `v<major>.<minor>` tag convention (no patch in the tag, but keep the full 4-tuple in the file for Windows compatibility).

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

Single-page app with hash-based routing (`#screen-setup`, `#screen-courses`, `#screen-sections`, `#screen-session`). All state lives in the `state` object. The PIN panel is a native **pywebview** window rendering `pip.html`, which polls `/api/pip/state` every 500 ms for live PIN and timer updates.
