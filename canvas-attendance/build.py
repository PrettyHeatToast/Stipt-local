import subprocess
import sys
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])
subprocess.check_call([
    sys.executable, "-m", "PyInstaller",
    "--onefile", "--noconsole",
    "--name", "Stipt Local",
    "--add-data", "templates;templates",
    "--collect-all", "icalendar",
    "--collect-all", "webview",
    "--hidden-import", "keyring.backends.Windows",
    "app.py",
])
print("\nBuild klaar. Je vindt Stipt Local.exe in de map dist\\.")
