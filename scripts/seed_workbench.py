#!/usr/bin/env python3
"""Seed Quality Workbench (connected-ai-dlc-tlc's app-state) with a baseline
project + release history, and mint a project-scoped bolt-ingest key for
e2e-bolt's Gate 2 push (see e2e-bolt/SKILL.md's "Push results to the
Workbench" section).

The historical releases seeded here mirror a real, already-in-use local
Workbench's own release history (labels/dates/status) - not invented data -
so a freshly-provisioned machine's Dashboard shows a realistic trend instead
of one lonely release.

The one release that matters for a fresh push is created fresh every run:
this team tests the UPCOMING release ahead of its own start date as routine
practice, so the release to seed as "the one to test" is always the next
Thursday from whenever this script actually runs, not a fixed date baked in
here. A bolt never needs to know this release's id - the ingest endpoint
resolves "the current (or soonest upcoming) release for this key's project"
itself, at push time (see routes/bolts.ts's resolveCurrentReleaseForProject).

Idempotent and never fatal to whatever called it, same shape as
seed_knowledge_assistant.py:
  - Unreachable app-state: prints one line, exits 0.
  - Project/release already exists (matched by code/label): reused, not
    duplicated.
  - --out-env already has a key: reused verbatim, never re-minted - a raw
    bolt-ingest key is only ever returned once, at creation.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Mirrors this Mac's own already-seeded Workbench history (see the project's
# own Dashboard) - real prior data, not invented, so a fresh machine's trend
# view looks like an established project's, not an empty one. Each
# snapshot_file (exported once via scripts/export_release_snapshot.py, not
# shipped as part of this script) carries the FULL requirement -> test case
# -> script -> project -> execution -> result depth for that release - see
# routes/release.ts's :id/import-snapshot for how it's applied.
SEED_DATA_DIR = Path(__file__).parent / "seed-workbench-data"
HISTORICAL_RELEASES = [
    {"label": "Thu 20 Aug", "startDate": "2026-08-20", "endDate": "2026-08-26", "status": "green", "snapshot_file": "rel-20aug.json"},
    {"label": "Thu 27 Aug", "startDate": "2026-08-27", "endDate": "2026-09-02", "status": "amber", "snapshot_file": "rel-27aug.json"},
]


def call(url: str, method: str, path: str, token: str | None = None, body: dict | None = None, timeout: int = 20) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Session-Token"] = token
    req = urllib.request.Request(f"{url}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read())
        except Exception:
            return exc.code, {}


def wait_healthy(url: str, attempts: int, delay: float) -> bool:
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=5) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(delay)
    return False


def next_thursday(today: dt.date) -> dt.date:
    """The release to seed as "the one to test" is always at least one full
    week out - the point is giving the team lead time to prepare before it
    goes live, so if today IS a Thursday, that means NEXT Thursday, not
    today (using today's own date would mean zero lead time - the release
    is already starting). Confirmed live, 2026-09-11: unpacking on Friday
    the 11th should seed Thursday the 17th, not the 11th - re-confirmed
    2026-09-12 that the Thursday-is-today case follows the same rule."""
    days_ahead = (3 - today.weekday()) % 7  # Monday=0 ... Thursday=3
    if days_ahead == 0:
        days_ahead = 7
    return today + dt.timedelta(days=days_ahead)


def release_label(start: dt.date) -> str:
    return f"Thu {start.day} {start.strftime('%b')}"


def read_ka_project_id(path: Path) -> str | None:
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("KNOWLEDGE_ASSISTANT_PROJECT_ID="):
            return line.split("=", 1)[1].strip()
    return None


def existing_key(out_path: Path) -> str | None:
    if not out_path.exists():
        return None
    for line in out_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("WORKBENCH_BOLT_INGEST_KEY="):
            return line.split("=", 1)[1].strip()
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default="http://localhost:3202")
    ap.add_argument("--access-code", default="quality-workbench-dev")
    ap.add_argument("--project-code", default="MDUI")
    ap.add_argument("--project-description", default="McKesson MDUI — FleetNet customer management")
    ap.add_argument("--key-label", default="bolt push (auto-provisioned)")
    ap.add_argument("--wait-attempts", type=int, default=12)
    ap.add_argument("--wait-delay", type=float, default=5.0)
    ap.add_argument("--out-env", required=True, help="where to write WORKBENCH_* for new-project.ps1 to pick up")
    ap.add_argument(
        "--ka-grounding-env", default=None,
        help="seed_knowledge_assistant.py's own --out-env file, to read KNOWLEDGE_ASSISTANT_PROJECT_ID from and "
             "link this Workbench project to it automatically. Omit to skip linking.",
    )
    args = ap.parse_args()

    out_path = Path(args.out_env)
    reused_key = existing_key(out_path)

    if not wait_healthy(args.url, args.wait_attempts, args.wait_delay):
        print(f"Quality Workbench not reachable at {args.url} - skipping seed (optional, non-fatal).")
        return 0

    status, session = call(args.url, "POST", "/api/auth/session", body={"accessCode": args.access_code})
    token = session.get("token") if status == 200 else None
    if not token:
        print(f"Login failed (status {status}) - skipping seed.")
        return 0

    status, projects = call(args.url, "GET", "/api/projects", token=token)
    project = next((p for p in projects if p.get("code") == args.project_code), None) if status == 200 else None
    if project:
        print(f"Project {args.project_code!r} already exists ({project['id']}).")
    else:
        status, project = call(
            args.url, "POST", "/api/projects", token=token,
            body={"code": args.project_code, "description": args.project_description},
        )
        if status not in (200, 201):
            print(f"Could not create project {args.project_code!r} (status {status}): {project} - skipping seed.")
            return 0
        print(f"Created project {args.project_code!r} ({project['id']}).")
    project_id = project["id"]

    # Link this Workbench project to its Knowledge Assistant project - the
    # same "toggle for MDUI and Save" action Project Settings' UI performs
    # by hand. Confirmed as a real gap, not theoretical: a team ran a fresh
    # pack/unpack, the seed scripts above provisioned both sides correctly,
    # and the UI still said "not linked to a Knowledge Assistant project"
    # until someone manually toggled and saved it - this closes that.
    # Union with whatever's already set, never overwrite: a human may have
    # deliberately scoped this project to additional KA projects beyond the
    # one this script knows about.
    if args.ka_grounding_env:
        ka_project_id = read_ka_project_id(Path(args.ka_grounding_env))
        if ka_project_id:
            status, settings = call(args.url, "GET", f"/api/projects/{project_id}/settings", token=token)
            current = settings.get("kaProjectIds", []) if status == 200 else []
            if ka_project_id in current:
                print(f"Already linked to Knowledge Assistant project {ka_project_id!r}.")
            else:
                status, updated = call(
                    args.url, "PUT", f"/api/projects/{project_id}/settings", token=token,
                    body={"kaProjectIds": [*current, ka_project_id]},
                )
                if status == 200:
                    print(f"Linked to Knowledge Assistant project {ka_project_id!r}.")
                else:
                    print(f"Could not link Knowledge Assistant project {ka_project_id!r} (status {status}): {updated}")
        else:
            print(f"No KNOWLEDGE_ASSISTANT_PROJECT_ID found in {args.ka_grounding_env} - skipping KA link.")

    status, existing_releases = call(args.url, "GET", f"/api/projects/{project_id}/releases", token=token)
    existing_releases = existing_releases if status == 200 else []
    existing_labels = {r["label"] for r in existing_releases}

    for release in HISTORICAL_RELEASES:
        existing = next((r for r in existing_releases if r["label"] == release["label"]), None)
        if existing:
            # Never import demo data into a release that already exists.
            # "Thu 20 Aug"/"Thu 27 Aug" are real calendar-anchored labels,
            # not obviously-fake demo names - a team with weeks of real
            # history (this one has) may already have a REAL release under
            # this exact label, and re-importing this script's own
            # canned snapshot would upsert fabricated release_items/
            # testCases on top of whatever real data already lives there.
            # Only ever seed a release this exact call just created.
            print(f"  release {release['label']!r} already exists ({existing['id']}) - leaving its data alone")
            continue

        body = {k: v for k, v in release.items() if k != "snapshot_file"}
        status, created = call(args.url, "POST", "/api/releases", token=token, body={**body, "projectId": project_id})
        if status != 201:
            print(f"  {release['label']!r}: {created} - skipping its snapshot")
            continue
        release_id = created["id"]
        print(f"  created release {release['label']!r} ({release_id})")

        snapshot_path = SEED_DATA_DIR / release["snapshot_file"]
        if not snapshot_path.is_file():
            print(f"    no snapshot file at {snapshot_path} - skipping")
            continue
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        status, result = call(args.url, "POST", f"/api/releases/{release_id}/import-snapshot", token=token, body=snapshot)
        if status == 200:
            print(f"    imported: {result.get('counts')}")
        else:
            print(f"    snapshot import failed (status {status}): {result}")

    today = dt.date.today()
    start = next_thursday(today)
    end = start + dt.timedelta(days=6)
    label = release_label(start)
    if label in existing_labels:
        print(f"Release to test ({label!r}) already exists.")
    else:
        status, created = call(
            args.url, "POST", "/api/releases", token=token,
            body={
                "label": label, "startDate": start.isoformat(), "endDate": end.isoformat(),
                "status": "not_started", "projectId": project_id,
            },
        )
        if status == 201:
            print(f"Created the release to test: {label!r} ({start.isoformat()} to {end.isoformat()}).")
        else:
            print(f"Could not create release {label!r} (status {status}): {created}")

    if reused_key:
        api_key = reused_key
        print("Bolt-ingest key already provisioned - reusing it (a raw key can only ever be read once).")
    else:
        status, key = call(
            args.url, "POST", "/api/bolt-ingest-keys", token=token,
            body={"label": args.key_label, "projectId": project_id},
        )
        if status != 200 or not key.get("apiKey"):
            print(f"Could not mint a bolt-ingest key (status {status}): {key}")
            return 0
        api_key = key["apiKey"]
        print("Minted a new bolt-ingest key.")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        "# Auto-provisioned by scripts/seed_workbench.py\n"
        "# Quality Workbench bolt push (e2e-bolt Gate 2) - merge into a bolt\n"
        "# workspace's own .env.local; new-project.ps1 does this automatically.\n"
        "# No release id: the ingest endpoint resolves the current (or soonest\n"
        "# upcoming) release for this key's project itself, at push time.\n"
        f"WORKBENCH_URL={args.url}\n"
        f"WORKBENCH_BOLT_INGEST_KEY={api_key}\n",
        encoding="utf-8",
    )
    print(f"Wrote Workbench config to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
