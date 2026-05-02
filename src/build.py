import subprocess
import sys
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller", "pillow"])

args = [
    sys.executable, "-m", "PyInstaller",
    "--noconsole",
    "--name", "Stipt Local",
    "--icon=../brand/stipt.ico",
    f"--add-data=templates{os.pathsep}templates",
    f"--add-data=../brand/stipt.ico{os.pathsep}.",
    "--collect-all", "icalendar",
    "--collect-all", "webview",
    "--hidden-import", "keyring.backends.macOS" if sys.platform == "darwin" else "keyring.backends.Windows",
    "app.py",
]
if sys.platform != "darwin":
    args.insert(3, "--onefile")          # Windows: single .exe; macOS: .app bundle
    args.insert(4, "--version-file=version_info.txt")

subprocess.check_call(args)
print("\nBuild klaar. Je vindt de output in de map dist/.")
