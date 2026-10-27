#!/usr/bin/env python3
"""Zostaví .ipk a pripraví súbory pre Homebrew Channel repozitár hostovaný na GitHube.

Použitie:   python3 tools/release.py --repo OWNER/REPO
Vytvorí:    dist/<id>_<verzia>_all.ipk, dist/<id>.manifest.json a repo.json (v koreni projektu)
Potom:      repo.json commitni do vetvy main a pod názvom vX.Y.Z vytvor GitHub release s .ipk aj manifestom
            (príkaz sa vypíše na konci). Používatelia pridajú v Homebrew Channel → Settings → Add repository
            adresu https://raw.githubusercontent.com/OWNER/REPO/main/repo.json
"""
import argparse, hashlib, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESC = "Neoficiálny prehrávač pre 360tka.sk (vyžaduje vlastné predplatné)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="GitHub repozitár vo formáte OWNER/REPO")
    ap.add_argument("--skip-build", action="store_true", help="nepúšťaj ares-package, použi existujúci .ipk v dist/")
    a = ap.parse_args()

    info = json.load(open(os.path.join(ROOT, "app", "appinfo.json"), encoding="utf-8"))
    app_id, ver = info["id"], info["version"]
    ipk_name = f"{app_id}_{ver}_all.ipk"
    dist = os.path.join(ROOT, "dist")

    if not a.skip_build:
        for old in os.listdir(dist) if os.path.isdir(dist) else []:
            if old.endswith(".ipk"):
                os.remove(os.path.join(dist, old))
        subprocess.check_call(["npx", "ares-package", "app", "-o", "dist", "--no-minify"], cwd=ROOT)
    ipk = os.path.join(dist, ipk_name)
    if not os.path.isfile(ipk):
        sys.exit(f"Chýba {ipk}")

    data = open(ipk, "rb").read()
    base = f"https://github.com/{a.repo}"
    icon = f"https://raw.githubusercontent.com/{a.repo}/main/app/largeIcon.png"
    manifest = {
        "id": app_id, "version": ver, "type": info.get("type", "web"), "title": info["title"],
        "appDescription": DESC, "iconUri": icon, "sourceUrl": base, "rootRequired": False,
        "ipkUrl": f"{base}/releases/download/v{ver}/{ipk_name}",
        "ipkHash": {"sha256": hashlib.sha256(data).hexdigest()},
        "ipkSize": len(data),
    }
    man_name = f"{app_id}.manifest.json"
    json.dump(manifest, open(os.path.join(dist, man_name), "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    repo = {"packages": [{
        "id": app_id, "title": info["title"], "shortDescription": DESC, "iconUri": icon,
        "manifestUrl": f"{base}/releases/latest/download/{man_name}",
    }]}
    json.dump(repo, open(os.path.join(ROOT, "repo.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    print(f"Hotovo: dist/{ipk_name}, dist/{man_name}, repo.json")
    print(f"\nRepozitár pre Homebrew Channel: https://raw.githubusercontent.com/{a.repo}/main/repo.json")
    print(f"\nRelease:\n  gh release create v{ver} dist/{ipk_name} dist/{man_name} --repo {a.repo} --title v{ver}")


if __name__ == "__main__":
    main()
