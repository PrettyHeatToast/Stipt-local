# Stipt. Local

Local web app for tracking student attendance via Canvas LMS. Runs a Flask server, opens in your browser automatically.

## Requirements

- Python 3.10+
- Canvas teacher or TA access on the target course
- The course must have an assignment group named **"Aanwezigheden"** (case-insensitive)
- The **New Quizzes** LTI must be enabled on your Canvas instance

## Setup

1. **Clone or download** this project folder.

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure credentials:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in:
   - `CANVAS_API_TOKEN` — generate one at Canvas → Account → Settings → New Access Token
   - `CANVAS_BASE_URL` — e.g. `https://arteveldehogeschool.instructure.com`

4. **Run:**
   ```bash
   python app.py
   ```
   Your browser opens automatically at `http://localhost:5050`.

## Usage

1. **Screen 1 — Kies een vak:** Browse or search your courses. Click a course to continue.
2. **Screen 2 — Selecteer secties:** Pick one or more sections. Click **Start sessie** — this creates a New Quiz in Canvas with a 4-digit access code.
3. **Screen 3 — Sessie:** Share the PIN with students so they can open the quiz. The PIN rotates every 10 minutes and updates the quiz automatically. Adjust each student's attendance (Aanwezig / Gedeeltelijk / Afwezig) using the +/− buttons.

## Notes

- All state is in-memory; closing the app or browser tab ends the session.
- The Canvas API token stays server-side — it is never sent to the browser.
- Grade submission to Canvas is not included in this version; scores are for your own reference during the session.
