import os
import sys
import webbrowser
from threading import Timer
from flask import Flask, jsonify, request, render_template
import requests
from dotenv import load_dotenv

if getattr(sys, 'frozen', False):
    _base_dir = os.path.dirname(sys.executable)
    _template_folder = os.path.join(sys._MEIPASS, 'templates')
else:
    _base_dir = os.path.dirname(os.path.abspath(__file__))
    _template_folder = os.path.join(_base_dir, 'templates')

load_dotenv(os.path.join(_base_dir, '.env'))

app = Flask(__name__, template_folder=_template_folder)

def _load_credentials():
    load_dotenv(os.path.join(_base_dir, '.env'), override=True)
    return os.getenv("CANVAS_API_TOKEN", ""), os.getenv("CANVAS_BASE_URL", "").rstrip("/")

CANVAS_API_TOKEN, CANVAS_BASE_URL = _load_credentials()

session_state = {
    "quiz_assignment_id": None,
    "quiz_id": None,       # New Quizzes UUID (needed for items API)
    "course_id": None,
    "current_pin": None,
}


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
    return render_template("index.html")


@app.route("/api/courses")
def get_courses():
    try:
        courses = canvas_get("/api/v1/courses", {
            "enrollment_type": "teacher",
            "per_page": 100,
            "state[]": "available",
        })
        return jsonify(courses)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
        assignment_id = next(
            (a["id"] for a in assignments if a.get("name") == title), None
        )
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

        import datetime
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
    })


@app.route("/api/config", methods=["POST"])
def save_config():
    global CANVAS_API_TOKEN, CANVAS_BASE_URL
    data = request.get_json()
    token = data.get("canvas_api_token", "").strip()
    base_url = data.get("canvas_base_url", "").strip().rstrip("/")
    if not token or not base_url:
        return jsonify({"error": "Beide velden zijn verplicht."}), 400
    env_path = os.path.join(_base_dir, '.env')
    with open(env_path, 'w') as f:
        f.write(f"CANVAS_API_TOKEN={token}\n")
        f.write(f"CANVAS_BASE_URL={base_url}\n")
    CANVAS_API_TOKEN, CANVAS_BASE_URL = _load_credentials()
    return jsonify({"success": True})


def open_browser():
    webbrowser.open("http://localhost:5050")


if __name__ == "__main__":
    Timer(1.0, open_browser).start()
    app.run(port=5050, debug=False)
