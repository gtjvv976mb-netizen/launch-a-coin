"""Install the original, wordless card-and-crown SVG identity. No image credits."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent.parent / "app/public/assets/brand"
PUBLIC.mkdir(parents=True, exist_ok=True)
master = (HERE / "carddex-master.svg").read_text()
mono = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="CardDex card and crown" color="COLOR"><g fill="currentColor"><path d="m31 33-11 5-5 75 8 8 1-6-5-5 5-69 7-3Z"/><path d="M37 29h54l9 9v76l-9 9H37l-9-9V38Zm2 8-3 4v69l5 5h46l5-5V41l-5-4H39Z" fill-rule="evenodd"/><path d="m26 11 20 12L64 2l18 21 20-12-8 21H34Zm8 20h60l-2 7H36Z"/><path d="m64 54 15 22-15 22-15-22Zm0 9L55 76l9 13 9-13Z" fill-rule="evenodd"/></g></svg>'''
for folder in (HERE, PUBLIC):
    (folder / "carddex.svg").write_text(master)
    (folder / "carddex-ink.svg").write_text(mono.replace("COLOR", "#29231b"))
    (folder / "carddex-white.svg").write_text(mono.replace("COLOR", "#ffffff"))
    # Retire every old wordmark so no stale brand variant can be selected later.
    for path in folder.glob("carddex-lockup*"):
        path.unlink()
print("Installed card and crown only; no visible letters or monogram.")
