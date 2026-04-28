import subprocess
import sys
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

args = [
    sys.executable, "-m", "PyInstaller",
    "--noconsole",
    "--name", "Stipt Local",
    f"--add-data=templates{os.pathsep}templates",
    "--collect-all", "icalendar",
    "--collect-all", "webview",
    "--hidden-import", "keyring.backends.macOS" if sys.platform == "darwin" else "keyring.backends.Windows",
    "app.py",
]
if sys.platform != "darwin":
    args.insert(2, "--onefile")  # Windows: single .exe; macOS: .app bundle

subprocess.check_call(args)
print("\nBuild klaar. Je vindt de output in de map dist/.")
