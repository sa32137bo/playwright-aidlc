"""Build and install a Windows Python wheel bundle; never copy virtualenvs.

Build runs on the connected Windows packaging machine. Prepare runs on the
recipient and uses only the verified wheelhouse. No third-party imports here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import time
import venv
import uuid

SCHEMA = 1
PROJECTS = (
    ("knowledgeassistant/capabilities", "knowledge-assistant-toolkit[dev]"),
    ("connected-ai-dlc-tlc/capabilities", "connected-ai-dlc-tlc[dev]"),
    ("knowledgeassistant/knowledge-service", "knowledge-service"),
)
GROUPS = {
    "framework": {"requirements": ["agentic-assembly[http]>=0.1.4"], "projects": [], "imports": "aaf.cli.start", "executables": ["aaf-start.exe"]},
    "capabilities": {"requirements": ["agentic-platform>=0.1.2"], "projects": list(PROJECTS[:2]), "imports": "aaf.cli.start,agentic_platform.cli,knowledge_assistant_toolkit,connected_ai_dlc_tlc", "executables": ["aaf-start.exe", "agentic-platform.exe"]},
    "knowledge-service": {"requirements": [], "projects": [PROJECTS[2]], "imports": "knowledge_service,chromadb,fastapi,uvicorn", "executables": ["uvicorn.exe"]},
    "workbench": {"requirements": [], "projects": [], "requirements_file": "toolkit-workbench/api/requirements.txt", "imports": "fastapi,uvicorn,aiosqlite,psutil,frontmatter", "executables": ["uvicorn.exe"]},
}
BUILD_TOOLS = ["pip", "setuptools", "wheel"]


def run(args, *, env=None, capture=False):
    return subprocess.run([str(a) for a in args], check=True, env=env,
                          text=True, stdout=subprocess.PIPE if capture else None)


def fingerprint():
    return {"python": f"{sys.version_info.major}.{sys.version_info.minor}",
            "implementation": sys.implementation.name, "platform": sysconfig.get_platform()}


def require_windows():
    if sys.platform != "win32" or sys.version_info < (3, 11):
        raise RuntimeError("Use Windows with Python 3.11 or newer to build/install this Windows bundle.")


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def sources(root):
    files = {}
    for relative, _ in PROJECTS:
        project = root / relative
        for path in [project / "pyproject.toml", *sorted((project / "src").rglob("*.py"))]:
            files[path.relative_to(root).as_posix()] = digest(path)
    path = root / "toolkit-workbench/api/requirements.txt"
    files[path.relative_to(root).as_posix()] = digest(path)
    return files


def offline_env(wheels, lock=None):
    env = os.environ.copy()
    # These reach pip AND uv invoked internally by aaf-start. Ignore machine
    # pip configuration so a corporate index/proxy cannot change resolution.
    env.update(PIP_NO_INDEX="1", PIP_FIND_LINKS=wheels.resolve().as_uri(), PIP_CONFIG_FILE=os.devnull,
               PIP_DISABLE_PIP_VERSION_CHECK="1", UV_NO_INDEX="true", UV_FIND_LINKS=wheels.resolve().as_uri(),
               UV_NO_BUILD_ISOLATION="true", UV_OFFLINE="true", UV_PYTHON_DOWNLOADS="never")
    if lock:
        env["PIP_CONSTRAINT"] = lock.resolve().as_uri()
        env["UV_CONSTRAINT"] = lock.resolve().as_uri()
    return env


def python_at(directory):
    return directory / "Scripts/python.exe"


def build_recipe_digest():
    # Covers GROUPS/BUILD_TOOLS/SCHEMA and everything else that decides what
    # gets built, without listing them separately - a version bump or a new
    # group in this file must invalidate a cached bundle exactly the way a
    # changed project source file already does, since sources(root) alone
    # cannot see a change to this script itself.
    return digest(Path(__file__))


def manifest_intact(manifest):
    claimed_id = manifest.get("bundle_id")
    content = {k: v for k, v in manifest.items() if k != "bundle_id"}
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest() == claimed_id


def bundle_problem(target, root, manifest):
    """None if `manifest` is fully backed by real, unmodified files under
    `target` (its own wheels/locks) and `root` (the project sources it was
    built from) - otherwise a description of what doesn't match. Shared by
    the recipient-side accept-as-real-target check and the packaging-side
    accept-as-reusable-build-cache check; same standard for both, since a
    cache that wouldn't be trusted as a real target must not be trusted as
    a cache either."""
    for base, entries in [(target, manifest["files"]), (root, manifest["sources"])]:
        for relative, expected in entries.items():
            path = (base / relative).resolve()
            if not path.is_relative_to(base.resolve()) or not path.is_file() or digest(path) != expected:
                return f"Missing or changed bundle file: {relative}."
    actual_wheels = {p.relative_to(target).as_posix() for p in target.rglob("*.whl")}
    expected_wheels = {p for p in manifest["files"] if p.endswith(".whl")}
    if actual_wheels != expected_wheels or sources(root) != manifest["sources"]:
        return "Bundle contains changed source files or an unexpected wheel set."
    return None


def cache_dir():
    return Path.home() / ".aaf/pack-cache"


def try_reuse_cached_bundle(root, target):
    """AAF/toolkit dependency updates are rare, so most pack.ps1 runs have
    nothing to actually rebuild. If the last successful build's cache
    matches this machine's Python, this script's own build recipe, AND the
    current project sources exactly, copy it into `target` instead of
    paying for a full wheel rebuild. Any mismatch, or any problem reading
    the cache, just falls through to a real build - this is purely a speed
    optimization, never a correctness shortcut, so a bad/stale/missing
    cache must never be worse than not having one."""
    cache = cache_dir()
    manifest_path = cache / "manifest.json"
    if not manifest_path.is_file():
        return False
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if manifest.get("schema") != SCHEMA or manifest.get("target") != fingerprint():
        return False
    if manifest.get("recipe") != build_recipe_digest():
        return False
    if not manifest_intact(manifest):
        return False
    if bundle_problem(cache, root, manifest):
        return False
    shutil.copytree(cache, target, dirs_exist_ok=True)
    print(f"Reusing cached offline Python bundle - sources unchanged since the last build ({cache}).")
    return True


def save_bundle_to_cache(target):
    # An optimization for NEXT time, not this build - already validated and
    # about to be zipped either way, so a caching problem here is a warning,
    # never a reason to fail a build that already succeeded.
    cache = cache_dir()
    try:
        if cache.exists():
            shutil.rmtree(cache)
        cache.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(target, cache)
    except OSError as error:
        print(f"Warning: could not save the pack cache for next time: {error}")


def validate_runtime(python, lock, expected_prefix, group):
    # Imports catch broken launchers/interpreters and missing native wheels;
    # pip check catches conflicting dependency sets. An existing Scripts dir
    # is never accepted as proof of a healthy environment.
    code = (
        "import sys,pathlib,importlib.metadata as m; "
        "assert pathlib.Path(sys.prefix).resolve()==pathlib.Path(sys.argv[1]).resolve(); "
        f"import {GROUPS[group]['imports']}; "
        "rows=pathlib.Path(sys.argv[2]).read_text().splitlines(); "
        "assert all(m.version(n)==v for n,v in (r.split('==',1) for r in rows if r)), 'Package versions differ from bundle lock'"
    )
    run([python, "-c", code, expected_prefix, lock])
    run([python, "-m", "pip", "check"], env=offline_env(lock.parent / "wheels", lock))
    for executable in GROUPS[group]["executables"]:
        if not (python.parent / executable).is_file():
            raise RuntimeError(f"Missing runtime executable: {executable}")


def build(root, registry, use_cache=True):
    require_windows()
    target = root / "vendor/aaf"
    target.mkdir(parents=True, exist_ok=False)
    if use_cache and try_reuse_cached_bundle(root, target):
        write_offline_markers(root)
        return
    artifacts = {}
    build_started = time.monotonic()
    # Preserve separate dependency sets. In particular the Workbench's pinned
    # FastAPI must not constrain ChromaDB or the toolkit runtime.
    with tempfile.TemporaryDirectory(prefix="aaf-wheel-build-") as tmp:
        builder = Path(tmp) / "builder"
        venv.create(builder, with_pip=True)
        python = python_at(builder)
        for group, config in GROUPS.items():
            # Printed as each phase starts, not just at the end - a silent
            # multi-minute build with no output is indistinguishable from a
            # hang, and a report of "it took N minutes" is not diagnosable
            # without knowing which group/phase actually took the time.
            group_started = time.monotonic()
            print(f"  [{group}] resolving and building wheels ({', '.join(config['requirements']) or 'project sources only'}) ...", flush=True)
            directory = target / group
            wheels = directory / "wheels"
            wheels.mkdir(parents=True)
            roots = [*BUILD_TOOLS, *config["requirements"]]
            project_paths = [str(root / path) + ("[dev]" if name.endswith("[dev]") else "") for path, name in config["projects"]]
            req_file = ["-r", root / config["requirements_file"]] if "requirements_file" in config else []
            wheel_started = time.monotonic()
            run([python, "-m", "pip", "wheel", "--wheel-dir", wheels, "--extra-index-url", registry,
                 *req_file, *roots, *project_paths])
            print(f"  [{group}] wheel build done in {time.monotonic() - wheel_started:.0f}s ({len(list(wheels.glob('*.whl')))} wheels)", flush=True)
            verification = Path(tmp) / group
            venv.create(verification, with_pip=True)
            check_python = python_at(verification)
            env = offline_env(wheels)
            print(f"  [{group}] installing into a fresh offline venv to verify ...", flush=True)
            run([check_python, "-m", "pip", "install", "--upgrade", "--no-index", "--find-links", wheels,
                 *req_file, *roots, *[name for _, name in config["projects"]]], env=env)
            versions = run([check_python, "-c", "import importlib.metadata as m; print('\\n'.join(sorted(d.metadata['Name']+'=='+d.version for d in m.distributions())))"], capture=True).stdout
            lock = directory / "requirements.lock"
            lock.write_text(versions, encoding="utf-8")
            validate_runtime(check_python, lock, verification, group)
            # Exercise the same editable install AAF can request after the
            # extraction path changes; all build dependencies must be local.
            for relative, _ in config["projects"]:
                run([check_python, "-m", "pip", "install", "--no-index", "--no-deps", "--no-build-isolation", "-e", root / relative], env=env)
            validate_runtime(check_python, lock, verification, group)
            if group == "capabilities":
                # Test the actual bundled AAF installer too: its absolute-path
                # install marker changes on extraction. Exercise pip and, when
                # available on the packaging machine, AAF's uv branch offline.
                print(f"  [{group}] exercising AAF's own installer (pip and uv paths) ...", flush=True)
                framework_python = python_at(Path(tmp) / "framework")
                for force_pip in (True, False):
                    for relative, _ in config["projects"]:
                        toolkit_root = (root / relative).parent
                        code = (
                            "from pathlib import Path; import sys; import aaf.cli.start as s; "
                            + ("s._uv=lambda: None; " if force_pip else "")
                            + "s._install_if_changed(Path(sys.argv[1]), Path(sys.argv[2]))"
                        )
                        for marker in verification.glob(".install.*.hash"):
                            marker.unlink()
                        run([framework_python, "-c", code, toolkit_root, verification], env=offline_env(wheels, lock))
                validate_runtime(check_python, lock, verification, group)
            for path in [*sorted(wheels.glob("*.whl")), lock]:
                artifacts[path.relative_to(target).as_posix()] = digest(path)
            print(f"  [{group}] done in {time.monotonic() - group_started:.0f}s total", flush=True)
    print(f"All groups built and verified in {time.monotonic() - build_started:.0f}s.", flush=True)
    manifest = {"schema": SCHEMA, "target": fingerprint(), "recipe": build_recipe_digest(), "files": artifacts, "sources": sources(root)}
    manifest["bundle_id"] = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    write_offline_markers(root)
    if use_cache:
        save_bundle_to_cache(target)
    print(f"Validated offline Python bundle: {len(artifacts)-len(GROUPS)} wheels; {fingerprint()}")


def write_offline_markers(root):
    # Each launcher detects offline mode itself, including Workbench processes
    # already running before unpack.ps1 (which cannot inherit its new env).
    for repo in ("knowledgeassistant", "connected-ai-dlc-tlc", "toolkit-workbench"):
        (root / repo / ".aaf-offline").write_text("Requires ../vendor/aaf/manifest.json\n", encoding="utf-8")


def verified_manifest(root):
    target = root / "vendor/aaf"
    path = target / "manifest.json"
    if not path.is_file():
        raise RuntimeError("Offline AAF bundle is missing. Rebuild the package with pack.ps1; VPN is not required on this machine.")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("schema") != SCHEMA:
        raise RuntimeError("Offline AAF bundle format is too old for this script. Rebuild the package with pack.ps1.")
    if manifest.get("target") != fingerprint():
        # A wheel built for one CPython minor version generally will not
        # load on another (compiled-extension ABI), so this is fixed on the
        # PACKAGING side, not here - do not try to install a different
        # Python on this machine to match an old bundle; rebuild the bundle
        # to match this machine's Python instead.
        raise RuntimeError(
            f"This bundle was built for Python {manifest.get('target')}, but this machine has "
            f"Python {fingerprint()}. Wheels built for one do not load on the other. Fix: on the "
            f"packaging machine, rebuild with a Python {fingerprint()['python']} interpreter - "
            f"powershell -ExecutionPolicy Bypass -File .\\scripts\\pack.ps1 -Python "
            f"\"<path to a {fingerprint()['python']} python.exe>\" -Force - then re-copy and re-extract "
            f"the new zip here. Installing a different Python on THIS machine is not the fix."
        )
    if not manifest_intact(manifest):
        raise RuntimeError("Offline AAF manifest is damaged; re-extract the package.")
    problem = bundle_problem(target, root, manifest)
    if problem:
        raise RuntimeError(f"{problem} Rebuild/re-extract the package.")
    return target, manifest


def stabilize_project_sources(root):
    # Editable installs and Windows launcher scripts bake in the absolute
    # source path at install time (see the comment on `location` below).
    # The raw extraction folder's own path changes on every pack/unzip/
    # unpack cycle - a fresh dated folder, a Windows "(2)" suffix on a
    # duplicate download - which would otherwise force a full reinstall on
    # every cycle even when nothing actually changed. Only PROJECTS (three
    # small pure-source directories) are ever editable-installed, so
    # mirroring just those into one fixed, permanent location is enough to
    # keep that baked-in path constant across every future cycle, letting
    # the venv cache below actually survive. Deliberately narrow: nothing
    # else (toolkit-workbench's database, node_modules, logs, anything
    # generated at runtime) is touched by this.
    stable_root = Path.home() / ".aidlc" / "capabilities-src"
    for relative, _ in PROJECTS:
        destination = stable_root / relative
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(root / relative, destination)
    return stable_root


def prepare(root, env_file=None):
    require_windows()
    target, manifest = verified_manifest(root)
    stable_root = stabilize_project_sources(root)
    # Own cache, separate from potentially broken old shared venvs. Keyed on
    # stable_root, not the raw extraction path - editable packages and
    # Windows launchers embed whatever absolute path they were installed
    # from, and stabilize_project_sources above already guarantees that
    # path never changes even when the raw extraction's own path does.
    location = hashlib.sha256(str(stable_root).encode()).hexdigest()[:16]
    runtimes = {}
    for group, config in GROUPS.items():
        directory = target / group
        runtime = Path.home() / ".aaf/offline" / manifest["bundle_id"][:16] / location / group
        runtimes[group] = runtime
        python = python_at(runtime)
        lock = directory / "requirements.lock"
        marker = runtime / ".ready"
        env = offline_env(directory / "wheels", lock)
        healthy = False
        if marker.is_file():
            try:
                validate_runtime(python, lock, runtime, group)
                healthy = True
            except (OSError, subprocess.CalledProcessError, RuntimeError) as exc:
                # Was silently discarded (bare `pass`) - confirmed as a real
                # cost, not theoretical: a `workbench` failure investigated
                # after the fact re-validated clean on every check (prefix,
                # imports, version pins, pip check, uvicorn.exe), so whatever
                # made this raise was transient, and the swallowed exception
                # was the only thing that could have said what.
                print(f"  [{group}] runtime failed validation, will rebuild: {exc}")
        if not healthy:
            if runtime.exists():
                try:
                    # Preserve failed environments for diagnosis; never
                    # overwrite the user's unrelated shared .aaf/venv.
                    runtime.rename(runtime.with_name(group + ".failed-" + uuid.uuid4().hex[:8]))
                except OSError as exc:
                    # Windows refuses this rename only when a running process
                    # still has a file inside `runtime` open - itself
                    # evidence the interpreter is live and serving something
                    # right now, not broken. Every toolkit start goes through
                    # the Workbench API, which runs from exactly this venv
                    # for group "workbench" - so a validation failure here
                    # can never self-heal by rebuilding without first killing
                    # the very process handling the request that triggered
                    # this prepare() call. Confirmed live: re-validating this
                    # venv by hand always passed, and a plain retry of the
                    # toolkit-start request succeeded once the venv was left
                    # alone. Use it as-is rather than crashing prepare()
                    # entirely or destroying a venv something else depends on.
                    print(f"  [{group}] runtime failed validation but is in use ({exc}) - leaving the existing venv in place rather than rebuilding a live one")
                    healthy = True
        if not healthy:
            venv.create(runtime, with_pip=True)
            run([python, "-m", "pip", "install", "--no-index", "--find-links", directory / "wheels", "-r", lock], env=env)
            for relative, _ in config["projects"]:
                run([python, "-m", "pip", "install", "--no-index", "--no-deps", "--no-build-isolation", "-e", stable_root / relative], env=env)
            validate_runtime(python, lock, runtime, group)
            marker.write_text(manifest["bundle_id"], encoding="utf-8")
    # AAF's own dependency check runs against capabilities. Both pip and uv
    # inherit this local source even when AAF passes an extra registry URL.
    env = offline_env(target / "capabilities/wheels", target / "capabilities/requirements.lock")
    env.update(AAF_VENV=str(runtimes["framework"]), AAF_CAPABILITIES_VENV=str(runtimes["capabilities"]),
               KNOWLEDGE_SERVICE_PYTHON=str(python_at(runtimes["knowledge-service"])),
               WORKBENCH_PYTHON=str(python_at(runtimes["workbench"])))
    if env_file:
        keys = ["AAF_VENV", "AAF_CAPABILITIES_VENV", "KNOWLEDGE_SERVICE_PYTHON", "WORKBENCH_PYTHON",
                "PIP_NO_INDEX", "PIP_FIND_LINKS", "PIP_CONFIG_FILE", "PIP_DISABLE_PIP_VERSION_CHECK", "PIP_CONSTRAINT",
                "UV_NO_INDEX", "UV_FIND_LINKS", "UV_NO_BUILD_ISOLATION", "UV_OFFLINE", "UV_PYTHON_DOWNLOADS", "UV_CONSTRAINT"]
        lines = []
        for key in keys:
            value = env[key]
            if any(c in value for c in '!"\r\n'):
                raise RuntimeError("Package/user paths must not contain !, quotes or newlines for Windows batch launchers.")
            value = value.replace("%", "%%")
            lines.append(f'SET "{key}={value}"')
        env_file.parent.mkdir(parents=True, exist_ok=True)
        env_file.write_text("@echo off\n" + "\n".join(lines) + "\n", encoding="utf-8")
    print("Offline AAF runtime validated; no private registry access required.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "prepare"])
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--registry", default="https://gitlab.prolifics.com/api/v4/projects/2434/packages/pypi/simple")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--no-cache", action="store_true",
                         help="Force a full rebuild; ignore any cached bundle from a previous build.")
    args = parser.parse_args()
    try:
        if args.action == "build":
            build(args.root.resolve(), args.registry, use_cache=not args.no_cache)
        else:
            prepare(args.root.resolve(), args.env_file)
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Offline AAF setup failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
