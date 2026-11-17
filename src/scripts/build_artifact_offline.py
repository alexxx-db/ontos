"""Build app_artifact/ with no package index, from dependency caches in UC volumes.

The offline counterpart of build_artifact.sh, for the dev-v2 target. It runs inside a
Databricks workspace that has no PyPI or npm egress and no pnpm (serverless compute:
Python 3.11+, pip, node and PyYAML are enough). Dependencies come from two caches:

  --npm-tarballs  one <name>-<version>.tgz per package in frontend/pnpm-lock.yaml
                  (scoped @a/b is a__b-<version>.tgz)
  --wheels        wheels for every backend dependency (CPython 3.11, Linux x86_64)

Steps:
  1. Install frontend/node_modules from the lockfile and the tarballs, in a hoisted
     layout, and check that every locked dependency edge resolves to its locked version.
  2. Run the vite build, which writes backend/static/.
  3. Resolve the backend's dependencies from the wheel cache for the Apps platform,
     without mlflow, which the backend never imports.
  4. Assemble the artifact. Apps rejects files of 10 MB or more, so wheels that large
     ship split into parts under big_wheels/, and source maps are left out.
     bootstrap.sh (the dev-v2 app command) joins the parts and installs them, plus
     the packages that depend on them, before it starts the app.

  python scripts/build_artifact_offline.py \\
    --npm-tarballs /Volumes/genie_agents/internal/npm/abacus-ontos/npm/tarballs \\
    --wheels /Volumes/genie_agents/internal/libraries/abacus-databricks-genie-workbench/abacus-ontos-python/abacus-ontos/python/wheels

Run from anywhere; paths are relative to src/. The build happens in --work (local
disk, default /tmp) because node_modules is too many small files for /Workspace.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tomllib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.utils import canonicalize_name

SRC = Path(__file__).resolve().parent.parent

# Apps rejects any file of 10 MB or more.
FILE_LIMIT = 10_000_000
PART_SIZE = 9_000_000
# Direct dependencies the app never imports, left out of the artifact.
DROP = {"mlflow"}

# The Apps runtime: CPython 3.11 on Linux x86_64.
PIP_TARGET = [
    "--only-binary=:all:", "--implementation", "cp", "--python-version", "3.11",
    "--abi", "cp311", "--abi", "abi3", "--abi", "none",
    "--platform", "manylinux_2_28_x86_64", "--platform", "manylinux_2_17_x86_64",
    "--platform", "manylinux2014_x86_64", "--platform", "any",
]
MARKER_ENV = {
    "python_version": "3.11", "python_full_version": "3.11.0", "sys_platform": "linux",
    "platform_system": "Linux", "platform_machine": "x86_64", "os_name": "posix",
    "implementation_name": "cpython", "platform_python_implementation": "CPython",
    "extra": "",
}

BOOTSTRAP = """#!/usr/bin/env bash
# Starts the app. numpy, pandas and pyarrow wheels are over the 10 MB Apps file
# limit, so they ship split in big_wheels/ and are reassembled and installed here,
# offline, before the app starts. databricks-sql-connector and databricks-sqlalchemy
# need them, so they install in the same step instead of from requirements.txt.
set -euo pipefail
cd "$(dirname "$0")"
T="$(mktemp -d)"
trap 'rm -rf -- "$T"' EXIT
for first in big_wheels/*.part00; do
  whl="${first%.part00}"
  cat "$whl".part* > "$T/$(basename "$whl")"
done
python -m pip install --quiet --disable-pip-version-check --no-index --find-links ./wheels \\
  "$T"/*.whl @LATE@
exec python backend/src/app.py
"""


def log(msg: str) -> None:
    print(f"build_artifact_offline: {msg}", flush=True)


def fail(msg: str) -> None:
    sys.exit(f"build_artifact_offline: error: {msg}")


# --- 1. node_modules from pnpm-lock.yaml and tarballs -------------------------------


def split_key(key: str) -> tuple[str, str]:
    """'@a/b@1.0.0(peer@2)' -> ('@a/b', '1.0.0')."""
    base = key.split("(", 1)[0]
    name, _, version = base.rpartition("@")
    return name, version


def dep_key(name: str, ref: str) -> str:
    """A snapshot key for a dependency. An alias's ref is '<real-name>@<version>'."""
    return ref if "@" in ref.split("(", 1)[0] else f"{name}@{ref}"


def tarball_name(name: str, version: str) -> str:
    return f"{name.lstrip('@').replace('/', '__')}-{version}.tgz"


def install_node_modules(frontend: Path, tarballs: Path) -> None:
    lock = yaml.safe_load((frontend / "pnpm-lock.yaml").read_text())
    if str(lock.get("lockfileVersion")) != "9.0":
        fail(f"expected pnpm lockfile v9, found {lock.get('lockfileVersion')}")
    snapshots: dict = lock["snapshots"]
    root = lock["importers"]["."]
    have = set(os.listdir(tarballs))

    def available(key: str) -> bool:
        return tarball_name(*split_key(key)) in have

    nm_root = frontend / "node_modules"
    contents: dict[Path, dict[str, str]] = collections.defaultdict(dict)  # node_modules dir -> name -> key
    placed: dict[Path, str] = {}  # package dir -> snapshot key
    queue: collections.deque[Path] = collections.deque()

    def place(name: str, key: str, nm: Path) -> None:
        contents[nm][name] = key
        placed[nm / name] = key
        queue.append(nm / name)

    def search_path(pkg_dir: Path) -> list[Path]:
        """node_modules dirs Node searches from pkg_dir, nearest first."""
        out, p = [], pkg_dir
        while True:
            if p.name != "node_modules":
                out.append(p / "node_modules")
            if p == frontend:
                return out
            p = p.parent

    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        for name, spec in (root.get(section) or {}).items():
            place(name, dep_key(name, spec["version"]), nm_root)

    skipped: list[str] = []
    # Breadth-first, so each node_modules dir is complete before its packages' own
    # dependencies are placed: a package resolves a name to the nearest copy, so a
    # dependency is hoisted to the root unless a different version is already there.
    while queue:
        pkg_dir = queue.popleft()
        snap = snapshots.get(placed[pkg_dir]) or {}
        deps = {**(snap.get("dependencies") or {}), **(snap.get("optionalDependencies") or {})}
        for name, ref in deps.items():
            key = dep_key(name, ref)
            if not available(key):
                skipped.append(f"{name} -> {key}")
                continue
            hit = next((contents[nm][name] for nm in search_path(pkg_dir) if name in contents[nm]), None)
            if hit is not None and split_key(hit) == split_key(key):
                continue
            place(name, key, nm_root if hit is None and name not in contents[nm_root] else pkg_dir / "node_modules")

    missing_direct = [str(d) for d, k in placed.items() if not available(k)]
    if missing_direct:
        fail(f"no tarball for {len(missing_direct)} direct dependencies, e.g. {missing_direct[:3]}")
    if skipped:
        log(f"{len(skipped)} dependency edges have no tarball and are skipped: {sorted(set(skipped))}")

    def extract(item: tuple[Path, str]) -> None:
        pkg_dir, key = item
        pkg_dir.mkdir(parents=True, exist_ok=True)
        with tarfile.open(tarballs / tarball_name(*split_key(key))) as tf:
            for member in tf.getmembers():
                # Strip the tarball's top directory (usually package/).
                parts = Path(member.name).parts[1:]
                if not parts or ".." in parts or member.issym() or member.islnk():
                    continue
                member.name = str(Path(*parts))
                tf.extract(member, pkg_dir, filter="data")

    with ThreadPoolExecutor(16) as pool:
        list(pool.map(extract, placed.items()))
    log(f"node_modules: {len(placed)} package instances")

    # Check with Node's own lookup rule that every locked edge resolves to its version.
    expected = []
    for pkg_dir, key in placed.items():
        snap = snapshots.get(key) or {}
        for name, ref in {**(snap.get("dependencies") or {}), **(snap.get("optionalDependencies") or {})}.items():
            k = dep_key(name, ref)
            if available(k):
                expected.append([str(pkg_dir), name, *split_key(k)])
    for section in ("dependencies", "devDependencies"):
        for name, spec in (root.get(section) or {}).items():
            expected.append([str(frontend), name, *split_key(dep_key(name, spec["version"]))])
    check = r"""
const fs = require('fs'), path = require('path');
const bad = [];
for (const [dir, name, real, version] of JSON.parse(fs.readFileSync(0))) {
  let p = dir, found = null;
  for (;;) {
    const c = path.join(p, 'node_modules', name, 'package.json');
    if (fs.existsSync(c)) { found = c; break; }
    const up = path.dirname(p); if (up === p) break; p = up;
  }
  const pj = found && JSON.parse(fs.readFileSync(found));
  if (!pj || pj.name !== real || pj.version !== version) bad.push([dir, name, pj ? pj.name + '@' + pj.version : 'missing', real + '@' + version]);
}
console.log(JSON.stringify(bad));
"""
    out = subprocess.run(["node", "-e", check], input=json.dumps(expected), capture_output=True, text=True, check=True)
    bad = json.loads(out.stdout)
    if bad:
        fail(f"{len(bad)} of {len(expected)} dependency edges resolve wrongly, e.g. {bad[:3]}")
    log(f"node_modules: all {len(expected)} locked dependency edges resolve to their locked versions")


# --- 3. Python dependencies from the wheel cache -----------------------------------


def pip_report(args: list[str], work: Path) -> dict:
    report = work / "pip-report.json"
    cmd = [sys.executable, "-m", "pip", "install", "--dry-run", "--quiet", "--disable-pip-version-check",
           "--ignore-installed", "--target", str(work / "pip-target"), "--report", str(report), *PIP_TARGET, *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        fail(f"pip could not resolve offline:\n{r.stderr[-3000:]}")
    return json.loads(report.read_text())


def resolve_python(wheels: Path, work: Path) -> list[dict]:
    direct = tomllib.loads((SRC / "pyproject.toml").read_text())["project"]["dependencies"]
    kept = [r for r in direct if canonicalize_name(Requirement(r).name) not in DROP]
    reqs = work / "direct.txt"
    reqs.write_text("\n".join(kept) + "\n")
    installs = pip_report(["--no-index", "--find-links", str(wheels), "-r", str(reqs)], work)["install"]
    names = {canonicalize_name(i["metadata"]["name"]) for i in installs}
    if names & DROP:
        fail(f"{sorted(names & DROP)} is still pulled in by another dependency")
    log(f"python: {len(installs)} packages resolved offline (left out: {sorted(DROP)})")
    return installs


def split_installs(installs: list[dict], wheels: Path) -> tuple[list[dict], list[dict], list[dict]]:
    """(early, big, late): requirements.txt, split wheels, and packages that need a big one."""
    by_name = {canonicalize_name(i["metadata"]["name"]): i for i in installs}
    for i in installs:
        i["wheel"] = wheels / os.path.basename(i["download_info"]["url"])
    big = {n for n, i in by_name.items() if i["wheel"].stat().st_size >= FILE_LIMIT}

    def requires(i: dict) -> set[str]:
        out = set()
        for spec in i["metadata"].get("requires_dist") or []:
            r = Requirement(spec)
            if r.marker is None or r.marker.evaluate(MARKER_ENV):
                out.add(canonicalize_name(r.name))
        return out & by_name.keys()

    late: set[str] = set()
    changed = True
    while changed:  # everything that depends, directly or not, on a big wheel
        changed = False
        for n, i in by_name.items():
            if n not in big | late and requires(i) & (big | late):
                late.add(n)
                changed = True
    early = [by_name[n] for n in sorted(by_name.keys() - big - late)]
    return early, [by_name[n] for n in sorted(big)], [by_name[n] for n in sorted(late)]


# --- 4. Assemble ---------------------------------------------------------------------


def pin(i: dict) -> str:
    return f"{canonicalize_name(i['metadata']['name'])}=={i['metadata']['version']}"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def assemble(out: Path, static: Path, early: list[dict], big: list[dict], late: list[dict], work: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    # Empty the directory but keep it: git tracks it through .gitkeep.
    for child in out.iterdir():
        if child.name != ".gitkeep":
            shutil.rmtree(child) if child.is_dir() and not child.is_symlink() else child.unlink()
    (out / "wheels").mkdir()
    (out / "big_wheels").mkdir()
    for i in early + late:
        shutil.copy2(i["wheel"], out / "wheels")
    for i in big:
        data, n = i["wheel"].read_bytes(), 0
        for n, start in enumerate(range(0, len(data), PART_SIZE)):
            (out / "big_wheels" / f"{i['wheel'].name}.part{n:02d}").write_bytes(data[start:start + PART_SIZE])
        joined = b"".join(p.read_bytes() for p in sorted((out / "big_wheels").glob(f"{i['wheel'].name}.part*")))
        if hashlib.sha256(joined).hexdigest() != sha256(i["wheel"]):
            fail(f"split parts of {i['wheel'].name} don't reassemble to the original")
    (out / "requirements.txt").write_text("--no-index\n--find-links ./wheels\n" + "".join(pin(i) + "\n" for i in early))
    boot = out / "bootstrap.sh"
    boot.write_text(BOOTSTRAP.replace("@LATE@", " ".join(pin(i) for i in late)))
    boot.chmod(0o755)

    # Source without tests or caches, as build_artifact.sh copies it.
    ignore = shutil.ignore_patterns("__pycache__", "test_*.py", "tests", "*.pyc")
    shutil.copytree(SRC / "backend" / "src", out / "backend" / "src", ignore=ignore)
    shutil.copytree(SRC / "backend" / "alembic", out / "backend" / "alembic", ignore=ignore)
    shutil.copy2(SRC / "backend" / "alembic.ini", out / "backend" / "alembic.ini")
    shutil.copytree(static, out / "backend" / "static", ignore=shutil.ignore_patterns("*.map"))

    # Check the two install steps the Apps container will run, offline.
    os.chdir(out)
    phase1 = pip_report(["-r", "requirements.txt"], work)["install"]
    joined = work / "joined"
    shutil.rmtree(joined, ignore_errors=True)
    joined.mkdir()
    for i in big:
        shutil.copy2(i["wheel"], joined)
    phase2 = pip_report(["--no-index", "--find-links", "./wheels", "-r", "requirements.txt",
                         *map(str, sorted(joined.iterdir())), *(pin(i) for i in late)], work)["install"]
    os.chdir(SRC)
    want = {pin(i) for i in early + big + late}
    if {pin(i) for i in phase1} != {pin(i) for i in early}:
        fail("requirements.txt does not install exactly its own pins offline")
    if {pin(i) for i in phase2} != want:
        fail("requirements.txt plus bootstrap.sh does not install the resolved set offline")

    files = [p for p in out.rglob("*") if p.is_file()]
    too_big = [str(p.relative_to(out)) for p in files if p.stat().st_size >= FILE_LIMIT]
    if too_big:
        fail(f"files over the Apps limit: {too_big}")
    largest = max(files, key=lambda p: p.stat().st_size)
    log(f"artifact: {len(files)} files, {sum(p.stat().st_size for p in files) / 1e6:.1f} MB, "
        f"largest {largest.relative_to(out)} ({largest.stat().st_size / 1e6:.1f} MB)")
    log(f"artifact: requirements.txt installs {len(phase1)} packages; bootstrap.sh adds "
        f"{', '.join(pin(i) for i in big + late)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--npm-tarballs", type=Path, required=True)
    ap.add_argument("--wheels", type=Path, required=True)
    ap.add_argument("--work", type=Path, default=Path("/tmp/ontos_offline_build"))
    ap.add_argument("--out", type=Path, default=SRC / "app_artifact")
    args = ap.parse_args()
    for p in (args.npm_tarballs, args.wheels):
        if not p.is_dir():
            fail(f"{p} is not a directory")
    if shutil.which("node") is None:
        fail("node is not on PATH")

    work = args.work.resolve()
    shutil.rmtree(work, ignore_errors=True)
    frontend = work / "src" / "frontend"
    shutil.copytree(SRC / "frontend", frontend, ignore=shutil.ignore_patterns("node_modules", "dist"))
    (work / "src" / "backend").mkdir()

    install_node_modules(frontend, args.npm_tarballs)
    env = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=8192"}
    subprocess.run(["node", "node_modules/vite/bin/vite.js", "build"], cwd=frontend, env=env, check=True)
    static = work / "src" / "backend" / "static"
    if not (static / "index.html").is_file():
        fail("vite build did not write backend/static/index.html")

    installs = resolve_python(args.wheels, work)
    early, big, late = split_installs(installs, args.wheels)
    assemble(args.out.resolve(), static, early, big, late, work)
    log(f"done: {args.out}")


if __name__ == "__main__":
    main()
