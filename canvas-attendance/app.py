import os
import re
import sys
import socket
import time
import datetime
import threading
from flask import Flask, jsonify, request, render_template, send_from_directory
import requests
import keyring
from icalendar import Calendar

if getattr(sys, 'frozen', False):
    _template_folder = os.path.join(sys._MEIPASS, 'templates')
    _icon_dir = sys._MEIPASS
else:
    _template_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'templates')
    _icon_dir = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

app = Flask(__name__, template_folder=_template_folder)

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(_icon_dir, 'ahs.ico')

_SERVICE = "StiptLocal"
_flask_error = None

def _load_credentials():
    return (
        keyring.get_password(_SERVICE, "canvas_api_token") or "",
        (keyring.get_password(_SERVICE, "canvas_base_url") or "").rstrip("/"),
        keyring.get_password(_SERVICE, "ical_url") or "",
    )

CANVAS_API_TOKEN, CANVAS_BASE_URL, ICAL_URL = _load_credentials()

session_state = {
    "quiz_assignment_id": None,
    "quiz_id": None,       # New Quizzes UUID (needed for items API)
    "course_id": None,
    "current_pin": None,
}

_pip_state: dict = {
    "pin": "0000",
    "seconds_left": 30,
    "total_seconds": 30,
    "session_seconds": 600,
}
_pip_window = None
_main_window = None


def canvas_get(path, params=None):
    headers = {"Authorization": f"Bearer {CANVAS_API_TOKEN}"}
    url = f"{CANVAS_BASE_URL}{path}"
    if not CANVAS_BASE_URL:
        raise ValueError("Canvas URL is niet geconfigureerd.")
    results = []
    while url:
        resp = requests.get(url, headers=headers, params=params)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            results.extend(data)
        else:
            return data
        link_header = resp.headers.get("Link", "")
        url = None
        params = None  # params only for first request
        for part in link_header.split(","):
            if 'rel="next"' in part:
                url = part.split(";")[0].strip().strip("<>")
                break
    return results


@app.route("/")
def index():
    is_native = bool(getattr(sys, "frozen", False) or os.environ.get("STIPT_WEBVIEW"))
    return render_template("index.html", is_native=is_native)


@app.route("/pip")
def pip_page():
    return render_template("pip.html")


@app.route("/api/pip/state", methods=["GET", "POST"])
def pip_state_route():
    global _pip_state
    if request.method == "POST":
        _pip_state.update(request.get_json(silent=True) or {})
        return jsonify({"ok": True})
    return jsonify(_pip_state)


@app.route("/api/courses")
def get_courses():
    try:
        courses = canvas_get("/api/v1/courses", {
            "enrollment_type": "teacher",
            "enrollment_state": "active",
            "per_page": 100,
            "state[]": "available",
        })
        return jsonify(_filter_current_year(courses))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


_YEAR_RE = re.compile(r'\b20\d{2}-\d{2}\b')

def _current_academic_year() -> str:
    """Return the current academic year as 'YYYY-YY' (e.g. '2025-26').
    Semester starts in September: Aug and earlier → previous start year."""
    today = datetime.date.today()
    y = today.year
    if today.month >= 9:
        return f"{y}-{str(y + 1)[2:]}"
    return f"{y - 1}-{str(y)[2:]}"

def _filter_current_year(courses: list) -> list:
    """Keep courses that either have no academic year in their name,
    or whose year matches the current academic year."""
    current = _current_academic_year()
    result = []
    for course in courses:
        years = _YEAR_RE.findall(course.get("name") or "")
        if not years or current in years:
            result.append(course)
    return result


def _ical_matches(summary: str, course_name: str, course_code: str) -> bool:
    """Return True when a TimeEdit SUMMARY and a Canvas course are likely the same course."""
    if course_name and course_name in summary:
        return True
    if course_code and course_code in summary:
        return True
    # Any word ≥4 chars from the summary that appears in the course name/code
    words = [w.strip(".,;:()") for w in summary.split()]
    for word in words:
        if len(word) >= 4 and (word in course_name or word in course_code):
            return True
    return False


@app.route("/api/ical-suggestions")
def get_ical_suggestions():
    """Return Canvas courses that appear in today's iCal schedule. Fails silently → []."""
    if not ICAL_URL:
        return jsonify([])
    today = datetime.date.today()
    try:
        resp = requests.get(ICAL_URL, timeout=5)
        resp.raise_for_status()
        cal = Calendar.from_ical(resp.content)
        events_today = [
            e for e in cal.walk('VEVENT')
            if e.get('DTSTART') and e.decoded('DTSTART').date() == today
        ]
    except Exception:
        return jsonify([])
    summaries = [
        str(e.get("SUMMARY", "")).strip().lower()
        for e in events_today
        if e.get("SUMMARY")
    ]
    if not summaries:
        return jsonify([])
    try:
        courses = canvas_get("/api/v1/courses", {
            "enrollment_type": "teacher",
            "enrollment_state": "active",
            "per_page": 100,
            "state[]": "available",
        })
        courses = _filter_current_year(courses)
    except Exception:
        return jsonify([])
    matched = []
    for course in courses:
        name = (course.get("name") or "").lower()
        code = (course.get("course_code") or "").lower()
        if any(_ical_matches(s, name, code) for s in summaries):
            matched.append({
                "id": course["id"],
                "name": course.get("name", ""),
                "course_code": course.get("course_code", ""),
            })
    return jsonify(matched)


@app.route("/api/courses/<int:course_id>/sections")
def get_sections(course_id):
    try:
        sections = canvas_get(f"/api/v1/courses/{course_id}/sections", {"per_page": 100})
        return jsonify(sections)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/courses/<int:course_id>/assignment_groups")
def get_assignment_groups(course_id):
    try:
        groups = canvas_get(f"/api/v1/courses/{course_id}/assignment_groups")
        return jsonify(groups)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/courses/<int:course_id>/create_quiz", methods=["POST"])
def create_quiz(course_id):
    data = request.get_json()
    title = data.get("title")
    assignment_group_id = data.get("assignment_group_id")
    pin = data.get("pin")
    section_ids = data.get("section_ids", [])

    headers = {
        "Authorization": f"Bearer {CANVAS_API_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "quiz": {
            "title": title,
            "assignment_group_id": assignment_group_id,
            "quiz_settings": {
                "require_student_access_code": True,
                "student_access_code": pin,
                "filter_ip_address": True,
                "ip_address_filter": "193.191.137.192/26"
            },
        }
    }
    def checked(step, resp):
        if not resp.ok:
            raise requests.HTTPError(
                f"Stap {step}: {resp.text}", response=resp
            )
        return resp

    assign_headers = {
        "Authorization": f"Bearer {CANVAS_API_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        # 1. Create the New Quiz
        resp = checked(1, requests.post(
            f"{CANVAS_BASE_URL}/api/quiz/v1/courses/{course_id}/quizzes",
            json=payload, headers=headers,
        ))
        quiz_data = resp.json()
        quiz_id = quiz_data.get("id")

        # 2. Add a confirmation question so students can submit
        checked(2, requests.post(
            f"{CANVAS_BASE_URL}/api/quiz/v1/courses/{course_id}/quizzes/{quiz_id}/items",
            json={
                "item": {
                    "entry_type": "Item",
                    "points_possible": 2,
                    "entry": {
                        "title": "Aanwezigheid bevestigen",
                        "item_body": "<p>Bevestig je aanwezigheid bij deze les.</p>",
                        "interaction_type_slug": "true-false",
                        "interaction_data": {
                            "true_choice": "Aanwezig",
                            "false_choice": "Afwezig",
                        },
                        "scoring_data": {"value": True},
                        "scoring_algorithm": "Equivalence",
                    },
                }
            },
            headers=headers,
        ))

        # 3. Find the Canvas assignment created for this quiz (not in quiz response)
        assignments = canvas_get(
            f"/api/v1/courses/{course_id}/assignments",
            {"search_term": title, "per_page": 10},
        )
        matching = [a for a in assignments if a.get("name") == title]
        assignment_id = max(matching, key=lambda a: a["id"])["id"] if matching else None
        if not assignment_id:
            raise ValueError(f"Kon het Canvas-assignment voor '{title}' niet vinden na aanmaken quiz.")

        # 4. Publish and limit visibility to selected sections only
        checked(4, requests.put(
            f"{CANVAS_BASE_URL}/api/v1/courses/{course_id}/assignments/{assignment_id}",
            json={
                "assignment": {
                    "published": True,
                    "points_possible": 2,
                    "only_visible_to_overrides": bool(section_ids),
                }
            },
            headers=assign_headers,
        ))

        # 5. Create an override for each selected section
        for section_id in section_ids:
            checked(5, requests.post(
                f"{CANVAS_BASE_URL}/api/v1/courses/{course_id}/assignments/{assignment_id}/overrides",
                json={"assignment_override": {"course_section_id": section_id}},
                headers=assign_headers,
            ))

        session_state["quiz_assignment_id"] = assignment_id
        session_state["quiz_id"] = quiz_id
        session_state["course_id"] = course_id
        session_state["current_pin"] = pin
        return jsonify({"quiz_assignment_id": assignment_id, "quiz": quiz_data})
    except requests.HTTPError as e:
        return jsonify({"error": f"Canvas API fout: {e}"}), e.response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/quiz/<quiz_assignment_id>/update_password", methods=["PATCH"])
def update_password(quiz_assignment_id):
    data = request.get_json()
    pin = data.get("pin")
    course_id = session_state.get("course_id")

    if not course_id:
        return jsonify({"error": "Geen actieve sessie"}), 400

    headers = {
        "Authorization": f"Bearer {CANVAS_API_TOKEN}",
        "Content-Type": "application/json",
    }
    quiz_id = session_state.get("quiz_id")
    if not quiz_id:
        return jsonify({"error": "Geen actieve quiz"}), 400

    payload = {"quiz": {"quiz_settings": {"student_access_code": pin}}}
    try:
        resp = requests.patch(
            f"{CANVAS_BASE_URL}/api/quiz/v1/courses/{course_id}/quizzes/{quiz_id}",
            json=payload,
            headers=headers,
        )
        resp.raise_for_status()
        session_state["current_pin"] = pin
        return jsonify({"success": True})
    except requests.HTTPError as e:
        return jsonify({"error": f"Canvas API fout: {e.response.text}"}), e.response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/session/end", methods=["POST"])
def end_session():
    assignment_id = session_state.get("quiz_assignment_id")
    course_id     = session_state.get("course_id")

    if not assignment_id or not course_id:
        return jsonify({"error": "Geen actieve sessie"}), 400

    headers = {
        "Authorization": f"Bearer {CANVAS_API_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        # Fetch current title so we can append the end time
        assign_resp = requests.get(
            f"{CANVAS_BASE_URL}/api/v1/courses/{course_id}/assignments/{assignment_id}",
            headers={"Authorization": f"Bearer {CANVAS_API_TOKEN}"},
        )
        assign_resp.raise_for_status()
        current_title = assign_resp.json().get("name", "Aanwezigheid")

        now = datetime.datetime.now()
        end_time = now.strftime("%H:%M")
        new_title = f"{current_title} (beëindigd {end_time})"
        lock_at = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        requests.put(
            f"{CANVAS_BASE_URL}/api/v1/courses/{course_id}/assignments/{assignment_id}",
            json={"assignment": {"name": new_title, "lock_at": lock_at}},
            headers=headers,
        ).raise_for_status()

        # Clear server-side session
        session_state.update({"quiz_assignment_id": None, "quiz_id": None,
                               "course_id": None, "current_pin": None})
        return jsonify({"success": True})
    except requests.HTTPError as e:
        return jsonify({"error": f"Canvas API fout: {e.response.text}"}), e.response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/session/submissions")
def get_submissions():
    assignment_id = session_state.get("quiz_assignment_id")
    course_id     = session_state.get("course_id")
    if not assignment_id or not course_id:
        return jsonify([])
    try:
        subs = canvas_get(
            f"/api/v1/courses/{course_id}/assignments/{assignment_id}/submissions",
            {"per_page": 100},
        )
        return jsonify(subs)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/session/grade", methods=["POST"])
def update_grade():
    data          = request.get_json()
    user_id       = data.get("user_id")
    score         = data.get("score")        # 0 | 0.5 | 1
    course_id     = data.get("course_id")
    assignment_id = data.get("assignment_id")

    grade = round(score * 2)  # 0→0, 0.5→1, 1→2

    headers = {
        "Authorization": f"Bearer {CANVAS_API_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.put(
            f"{CANVAS_BASE_URL}/api/v1/courses/{course_id}/assignments/{assignment_id}/submissions/{user_id}",
            json={"submission": {"posted_grade": str(grade)}},
            headers=headers,
        )
        resp.raise_for_status()
        return jsonify({"success": True})
    except requests.HTTPError as e:
        return jsonify({"error": f"Canvas API fout: {e.response.text}"}), e.response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/courses/<int:course_id>/enrollments")
def get_enrollments(course_id):
    section_ids_param = request.args.get("section_ids", "")
    section_ids = [s.strip() for s in section_ids_param.split(",") if s.strip()]

    try:
        if section_ids:
            all_students = {}
            for section_id in section_ids:
                students = canvas_get(
                    f"/api/v1/sections/{section_id}/enrollments",
                    {"type[]": "StudentEnrollment", "per_page": 100},
                )
                for s in students:
                    all_students[s["user_id"]] = s
            return jsonify(list(all_students.values()))
        else:
            students = canvas_get(
                f"/api/v1/courses/{course_id}/enrollments",
                {"type[]": "StudentEnrollment", "per_page": 100},
            )
            return jsonify(students)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/me")
def get_me():
    try:
        user = canvas_get("/api/v1/users/self")
        return jsonify({"name": user.get("short_name") or user.get("name", "")})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify({
        "configured": bool(CANVAS_API_TOKEN and CANVAS_BASE_URL),
        "canvas_base_url": CANVAS_BASE_URL,
        "ical_url": ICAL_URL,
    })


@app.route("/api/config", methods=["POST"])
def save_config():
    global CANVAS_API_TOKEN, CANVAS_BASE_URL, ICAL_URL
    data = request.get_json()
    token    = data.get("canvas_api_token", "").strip()
    base_url = data.get("canvas_base_url", "").strip().rstrip("/")
    ical_url = data.get("ical_url", "").strip()           # optional
    if not token or not base_url:
        return jsonify({"error": "Beide velden zijn verplicht."}), 400
    keyring.set_password(_SERVICE, "canvas_api_token", token)
    keyring.set_password(_SERVICE, "canvas_base_url", base_url)
    keyring.set_password(_SERVICE, "ical_url", ical_url)
    CANVAS_API_TOKEN, CANVAS_BASE_URL, ICAL_URL = _load_credentials()
    return jsonify({"success": True})


def _run_flask():
    global _flask_error
    try:
        app.run(port=5050, debug=False, use_reloader=False)
    except Exception as exc:
        _flask_error = str(exc)

def _wait_for_port(port, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                return True
        except OSError:
            time.sleep(0.05)
    return False

class JsApi:
    def open_pip(self):
        global _pip_window, _main_window
        if _pip_window and _pip_window in webview.windows:
            _pip_window.show()
            return
        _pip_window = webview.create_window(
            "Stipt PIN",
            "http://localhost:5050/pip",
            width=380,
            height=260,
            resizable=False,
            on_top=True,
        )
        def _on_closed():
            global _pip_window
            _pip_window = None
            if _main_window:
                _main_window.evaluate_js("pipNativeOpen = false; updatePipBtn();")
        _pip_window.events.closed += _on_closed

    def close_pip(self):
        global _pip_window
        if _pip_window:
            _pip_window.destroy()
            _pip_window = None

    def is_pip_open(self):
        return _pip_window is not None and _pip_window in webview.windows


if __name__ == "__main__":
    if getattr(sys, 'frozen', False) or os.environ.get("STIPT_WEBVIEW"):
        import webview
        t = threading.Thread(target=_run_flask, daemon=True)
        t.start()
        if not _wait_for_port(5050):
            import tkinter
            import tkinter.messagebox
            tkinter.Tk().withdraw()
            tkinter.messagebox.showerror(
                "Stipt. Local",
                f"Kon de server niet starten.\n{_flask_error or 'Poort 5050 is bezet.'}",
            )
            sys.exit(1)
        _main_window = webview.create_window(
            "Stipt. Local",
            "http://localhost:5050",
            width=1100,
            height=800,
            min_size=(800, 600),
            js_api=JsApi(),
        )

        def _on_main_closing():
            if session_state.get("quiz_assignment_id"):
                return _main_window.evaluate_js(
                    "confirm('Er is nog een actieve check-in sessie.\\n\\n"
                    "Wil je de app toch afsluiten? "
                    "Studenten kunnen daarna de quiz niet meer indienen.')"
                )

        _main_window.events.closing += _on_main_closing
        webview.start()
    else:
        import webbrowser
        from threading import Timer
        Timer(1.0, lambda: webbrowser.open("http://localhost:5050")).start()
        app.run(port=5050, debug=False)
