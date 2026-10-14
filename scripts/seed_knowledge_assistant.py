#!/usr/bin/env python3
"""Seed Knowledge Assistant with this project's baseline documents and mint a
grounding API key for external, bolt-time retrieval (e2e-intake step 4a).

Talks to knowledge-service DIRECTLY (its own port, default 8011) - NOT the
AAF gateway (9004). create-project/upload-document/create-grounding-api-key
are deliberately not wired into assemblies.yaml's persona bindings (grounding
keys are their own, simpler bearer-auth story for external callers with no
AAF consumer identity at all - see auth/__init__.py's own module docstring),
so the gateway has no persona that can satisfy them.

Idempotent, never fatal to whatever called it - unpack.ps1 calls this after
starting knowledgeassistant and does not care whether it succeeds:
  - Unreachable knowledge-service: prints one line, exits 0.
  - Project already exists: reused, not recreated.
  - A seed file already uploaded (same content hash): the upload connector's
    own delta sync no-ops it.
  - --out-env already has a key: reused as-is, IF knowledge-service still
    accepts it (see key_still_enabled(), or its key_accepted_by_grounding_
    auth() fallback for an env file written before KNOWLEDGE_ASSISTANT_KEY_ID
    was recorded) - a raw grounding key is only ever returned once, at
    creation, so an accepted one is never re-minted. A rejected one (e.g.
    knowledge-service's DB was reset since it was minted) is silently
    replaced rather than propagated dead into every future workspace.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_SEED_DIR = Path(__file__).parent / "seed-knowledge" / "mdui"


def call(url: str, capability: str, params: dict, timeout: int = 20) -> dict:
    body = json.dumps({"capability": capability, "params": params}).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/execute", data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def wait_healthy(url: str, attempts: int, delay: float) -> bool:
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=5) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(delay)
    return False


def upload_file(url: str, project_id: str, auth_token: str, path: Path) -> dict:
    # Multipart built by hand (stdlib only, no requests dependency) - matches
    # POST /upload's own field names (project_id, auth_token, sync, file).
    boundary = f"----seedknowledge{int(time.time() * 1000)}"
    nl = b"\r\n"

    def field(name: str, value: str) -> bytes:
        return (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
        ).encode("utf-8")

    parts = [
        field("project_id", project_id),
        field("auth_token", auth_token),
        field("sync", "true"),
        (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{path.name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8"),
        path.read_bytes(),
        nl + f"--{boundary}--\r\n".encode("utf-8"),
    ]
    req = urllib.request.Request(
        f"{url}/upload",
        data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def existing_value(out_path: Path, var: str) -> str | None:
    if not out_path.exists():
        return None
    for line in out_path.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{var}="):
            return line.split("=", 1)[1].strip()
    return None


def key_still_enabled(url: str, token: str, key_id: str) -> bool | None:
    """Ask knowledge-service directly whether key_id is still a known,
    enabled grounding key. Uses the admin token main() already holds for
    project/document setup, so checking has no side effect on the key itself
    - unlike key_accepted_by_grounding_auth's fallback, which has to spend a
    real (if harmless) grounding call to find out.

    Returns None - "inconclusive" - on a request failure or an unrecognised
    response shape, so the caller falls back rather than either trusting a
    dead key or minting a needless duplicate on a transient blip.
    """
    try:
        result = call(url, "list-grounding-api-keys", {"auth_token": token})
    except (urllib.error.URLError, TimeoutError):
        return None
    if not result.get("success"):
        return None
    keys = result.get("data", {}).get("keys")
    if not isinstance(keys, list):
        return None
    return any(k.get("key_id") == key_id and k.get("enabled") for k in keys)


def key_accepted_by_grounding_auth(url: str, api_key: str) -> bool:
    """Fallback for a cached key minted before KNOWLEDGE_ASSISTANT_KEY_ID was
    recorded alongside it (an env file from before this check existed) - the
    only way left to ask "is this exact key still valid" without its key_id
    for a direct key_still_enabled() lookup.

    A reused key is only ever a hash lookup away from silently dead: the
    knowledge-service DB can be reset or redeployed between unpack runs,
    which revokes every previously-minted key without touching this script's
    own cached .env file (GHC run-12: a stale key was reused verbatim into
    every workspace for two bolts running before anyone noticed the 401).

    Grounding-key auth runs before any other param validation in
    execute_capability (see main.py), so a bare api_key with no project_id/
    story_text still proves whether the key itself is accepted: a dead key
    comes back as status 401, a live one comes back as some other outcome
    (success, or a ValueError about the missing params - which the handler
    logs as a real, if harmless, audit entry; key_still_enabled avoids that
    entirely and should be preferred whenever a key_id is on hand).
    """
    try:
        result = call(url, "prepare-story-grounding", {"api_key": api_key})
    except (urllib.error.URLError, TimeoutError):
        # Can't reach the service to check - assume valid rather than mint a
        # duplicate key on a transient network blip; the real health check
        # already ran in wait_healthy() before this is called.
        return True
    return result.get("status") != 401


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default="http://localhost:8011", help="knowledge-service's own port, not the AAF gateway")
    ap.add_argument("--project-id", default="mdui")
    ap.add_argument("--project-name", default="MDUI")
    ap.add_argument("--seed-dir", default=str(DEFAULT_SEED_DIR))
    ap.add_argument("--admin-user", default="admin")
    ap.add_argument("--admin-password", default="admin123")
    ap.add_argument("--key-label", default="bolt grounding (auto-provisioned)")
    ap.add_argument("--wait-attempts", type=int, default=12)
    ap.add_argument("--wait-delay", type=float, default=5.0)
    ap.add_argument("--out-env", required=True, help="where to write KNOWLEDGE_ASSISTANT_* for new-project.ps1 to pick up")
    args = ap.parse_args()

    out_path = Path(args.out_env)
    reused_key = existing_value(out_path, "KNOWLEDGE_ASSISTANT_API_KEY")
    reused_key_id = existing_value(out_path, "KNOWLEDGE_ASSISTANT_KEY_ID")

    if not wait_healthy(args.url, args.wait_attempts, args.wait_delay):
        print(f"Knowledge Assistant not reachable at {args.url} - skipping seed (optional, non-fatal).")
        return 0

    try:
        login = call(args.url, "login", {"username": args.admin_user, "password": args.admin_password})
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Login request failed: {exc} - skipping seed.")
        return 0
    if not login.get("success"):
        print(f"Login failed: {login.get('error')} - skipping seed.")
        return 0
    token = login["data"]["token"]

    project = call(args.url, "get-project", {"project_id": args.project_id, "auth_token": token})
    if project.get("success"):
        print(f"Project {args.project_id!r} already exists ({project['data'].get('documents', 0)} document(s)).")
    else:
        created = call(
            args.url, "create-project",
            {"name": args.project_name, "project_id": args.project_id, "auth_token": token},
        )
        if not created.get("success"):
            print(f"Could not create project {args.project_id!r}: {created.get('error')} - skipping seed.")
            return 0
        print(f"Created project {args.project_id!r}.")

    seed_dir = Path(args.seed_dir)
    if not seed_dir.is_dir():
        print(f"No seed directory at {seed_dir} - nothing to upload.")
    else:
        for f in sorted(seed_dir.glob("*")):
            if not f.is_file():
                continue
            result = upload_file(args.url, args.project_id, token, f)
            if result.get("success"):
                print(f"  uploaded {f.name}")
            else:
                print(f"  {f.name}: {result.get('detail') or result.get('error')}")

    # An upload source is auto-created with external_grounding_eligible=False
    # (knowledge-service's own /upload handler never passes it) - confirmed
    # as a real, silent gap (GHC run-11): e2e-intake step 4a's grounding call
    # succeeded (HTTP 200) but returned has_knowledge: false, "no sources in
    # this project are eligible for external grounding", because nothing had
    # ever explicitly opted this project's own uploaded docs in. Same
    # deterministic source_id knowledge-service's own /upload derives
    # (_project_upload_source_id) - never invented here, so this always
    # targets the exact source uploads just landed in.
    source_id = f"{args.project_id}-uploads"
    eligible = call(
        args.url, "update-source",
        {"source_id": source_id, "external_grounding_eligible": True, "auth_token": token},
    )
    if eligible.get("success"):
        print(f"  {source_id!r} marked eligible for external (bolt-time) grounding")
    else:
        print(f"  could not mark {source_id!r} eligible for external grounding: {eligible.get('error')}")

    if reused_key:
        still_valid = key_still_enabled(args.url, token, reused_key_id) if reused_key_id else None
        if still_valid is None:
            still_valid = key_accepted_by_grounding_auth(args.url, reused_key)
        if not still_valid:
            print("Existing grounding key was rejected by knowledge-service (revoked, or its DB was reset since) - minting a new one.")
            reused_key = None
            reused_key_id = None

    if reused_key:
        api_key, key_id = reused_key, reused_key_id
        print("Grounding key already provisioned - reusing it (a raw key can only ever be read once).")
    else:
        key = call(
            args.url, "create-grounding-api-key",
            {"label": args.key_label, "project_ids": [args.project_id], "auth_token": token},
        )
        if not key.get("success"):
            print(f"Could not mint a grounding key: {key.get('error')}")
            return 0
        api_key, key_id = key["data"]["api_key"], key["data"]["key_id"]
        print("Minted a new grounding API key.")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    key_id_line = f"KNOWLEDGE_ASSISTANT_KEY_ID={key_id}\n" if key_id else ""
    out_path.write_text(
        "# Auto-provisioned by scripts/seed_knowledge_assistant.py\n"
        "# Knowledge Assistant grounding (e2e-intake step 4a) - merge into a bolt\n"
        "# workspace's own .env.local; new-project.ps1 does this automatically.\n"
        f"KNOWLEDGE_ASSISTANT_URL={args.url}\n"
        f"KNOWLEDGE_ASSISTANT_API_KEY={api_key}\n"
        f"KNOWLEDGE_ASSISTANT_PROJECT_ID={args.project_id}\n"
        f"{key_id_line}",
        encoding="utf-8",
    )
    print(f"Wrote grounding config to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
