# Stipt. Local

Local attendance tracking app for teachers, built on top of Canvas LMS. A Flask server runs on your machine and proxies all Canvas API calls — your API token never reaches the browser.

## Requirements

- Python 3.10+
- Canvas teacher or TA access on the target course
- The course must have an assignment group named **"Aanwezigheden"** (case-insensitive)
- The **New Quizzes** LTI must be enabled on your Canvas instance

## Running from source

```bash
cd src
pip install -r requirements.txt
python app.py
```

Your browser opens automatically at `http://localhost:5050`. On first run, a setup screen prompts you for your Canvas credentials.

## Standalone executable

Pre-built binaries are attached to each [GitHub Release](../../releases). Download the `.exe` (Windows) or `.zip` (macOS), run it — no Python required.

## Credentials

The app stores settings in `settings.json` next to the executable (or next to `app.py` when running from source). Your Canvas API token is stored in the system keychain via `keyring` and is never written to disk in plain text.

To generate a Canvas API token: **Canvas → Account → Settings → New Access Token**.

## Usage

1. **Courses** — Browse or search your active courses. Click a course to continue.
2. **Sections** — Pick one or more sections, then click **Start sessie**. This creates a New Quiz in Canvas with a randomly generated 4-digit access code.
3. **Session** — Share the PIN with students so they can open the quiz. The PIN rotates automatically (default every 30 seconds) and updates the quiz in real time. Mark each student **Actief aanwezig**, **Aanwezig**, or **Afwezig** using the +/− buttons. Grades sync to Canvas on every change.

A detachable **PIN display window** (Picture-in-Picture) shows the current PIN and countdown timer and can be kept visible while you manage the session.

## Score mapping

| Status | Points |
|---|---|
| Actief aanwezig | 2 |
| Aanwezig | 1 |
| Afwezig | 0 |

## Settings

Configurable via the in-app settings screen:

| Setting | Default | Description |
|---|---|---|
| Canvas base URL | — | Your institution's Canvas URL |
| iCal URL | — | Optional calendar feed to show today's schedule |
| Session duration | 600 s | How long a session runs before auto-ending |
| PIN duration | 30 s | How often the access code rotates |
| Default score | 1 | Starting score for each student when a session begins |

## Building

```bash
python src/build.py
```

Produces `src/dist/Stipt Local.exe` (Windows) or a `.app` bundle zipped as `.zip` (macOS) via PyInstaller.

## Releasing

1. Edit `src/version_info.txt` — update both tuples and both version strings.
2. Commit and push a tag matching `v*` (e.g. `v1.3`).
3. GitHub Actions builds Windows + macOS artifacts and publishes a GitHub Release automatically.
