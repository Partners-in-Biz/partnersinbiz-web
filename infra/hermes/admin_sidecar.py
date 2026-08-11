"""Hermes admin sidecar — small HTTP service to inspect/manage profile skills.
Exposed on 127.0.0.1:8651. Caddy proxies /profiles/<name>/admin/* to it.
Auth: callers must provide the profile API key (X-API-Key or Authorization: Bearer).
"""
import io
import json
import os
import re
import shutil
import secrets
import tempfile
import subprocess
import zipfile
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, UploadFile, File, Request
from fastapi.responses import JSONResponse
import yaml

PROFILES_ROOT = Path("/var/lib/hermes/profiles")
ENV_ROOT = Path("/etc/hermes/profiles")

app = FastAPI(title="hermes-admin-sidecar", version="0.1.0")

SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")

def _load_profile_key(profile: str) -> Optional[str]:
    env_file = ENV_ROOT / f"{profile}.env"
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        if line.startswith("API_SERVER_KEY="):
            return line.split("=", 1)[1].strip()
    return None

def _require_auth(profile: str, x_api_key: Optional[str], authorization: Optional[str]):
    if not SAFE_NAME.match(profile):
        raise HTTPException(status_code=400, detail="invalid profile name")
    expected = _load_profile_key(profile)
    if not expected:
        raise HTTPException(status_code=404, detail="profile env not found")
    presented = x_api_key
    if not presented and authorization and authorization.lower().startswith("bearer "):
        presented = authorization[7:].strip()
    if not presented or presented != expected:
        raise HTTPException(status_code=401, detail="invalid api key")

def _profile_dir(profile: str) -> Path:
    return PROFILES_ROOT / profile

def _skills_dir(profile: str) -> Path:
    return _profile_dir(profile) / "skills"


def _env_file(profile: str) -> Path:
    return ENV_ROOT / f"{profile}.env"


def _config_file(profile: str) -> Path:
    return _profile_dir(profile) / "config.yaml"


# Busy-safe restarts: never force-kill an in-flight Messages /v1/runs connection.
# Root-owned sweeper also watches /var/lib/partnersinbiz/hermes-restart-pending;
# the sidecar runs as hermes so it marks pending under HERMES_HOME (writable).
_HERMES_HOME = Path(os.environ.get("HERMES_HOME", "/var/lib/hermes"))
_SIDECAR_PENDING_DIR = Path(
    os.environ.get(
        "PIB_HERMES_SIDECAR_PENDING_DIR",
        str(_HERMES_HOME / "hermes-restart-pending"),
    )
)
_ROOT_PENDING_DIR = Path(
    os.environ.get("PIB_HERMES_PENDING_DIR", "/var/lib/partnersinbiz/hermes-restart-pending")
)
_PROFILE_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


def _profile_api_port(profile: str) -> Optional[int]:
    env_path = _env_file(profile)
    if not env_path.exists():
        return None
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped.startswith("API_SERVER_PORT="):
            continue
        raw = stripped.split("=", 1)[1].strip().strip('"').strip("'")
        if raw.isdigit():
            return int(raw)
    return None


# Long-lived edge keepalives only. Do NOT ignore pib-runtime — linked Messages
# dispatch holds that connection for live runs; filtering it made OAuth restarts
# look idle and SIGTERM mid-chat.
_IDLE_PEER_MARKERS = (
    '"sshd"',
    "caddy",
)


def _established_connection_count(port: int) -> int:
    """Count clients connected TO the profile API port (active /v1/runs).

    Uses `dport = :port` so `ss -tnp` labels the *client* process (not hermes itself).
    Ignores long-lived keepalives (pib-runtime, caddy, sshd) that would otherwise
    make every profile look permanently busy.
    """
    try:
        result = subprocess.run(
            ["ss", "-tnp", "state", "established", f"( dport = :{port} )"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return 0
    lines = [line for line in (result.stdout or "").splitlines() if line.strip()]
    if not lines:
        return 0
    body = lines[1:] if (
        lines[0].lower().startswith("recv-q") or lines[0].lower().startswith("state")
    ) else lines
    count = 0
    for line in body:
        lower = line.lower()
        if any(marker in lower for marker in _IDLE_PEER_MARKERS):
            continue
        count += 1
    return count


def _profile_is_busy(profile: str) -> bool:
    port = _profile_api_port(profile)
    if port is None:
        return False
    return _established_connection_count(port) > 0


def _mark_pending_restart(profile: str, reason: str) -> bool:
    """Queue a deferred restart for the 2-minute sweeper. Prefer hermes-writable dir."""
    if not _PROFILE_NAME_RE.match(profile or ""):
        return False
    payload = (
        f"profile={profile}\n"
        f"reason={reason}\n"
        f"marked_at={datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}\n"
        f"source=admin-sidecar\n"
    )
    for pending_dir in (_SIDECAR_PENDING_DIR, _ROOT_PENDING_DIR):
        try:
            pending_dir.mkdir(parents=True, exist_ok=True)
            target = pending_dir / profile
            fd, tmp = tempfile.mkstemp(prefix=f".{profile}_", suffix=".pending", dir=str(pending_dir))
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    handle.write(payload)
                os.chmod(tmp, 0o600)
                os.replace(tmp, target)
                return True
            except Exception:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
        except OSError:
            continue
    return False


def _clear_pending_restart(profile: str) -> None:
    for pending_dir in (_SIDECAR_PENDING_DIR, _ROOT_PENDING_DIR):
        try:
            (pending_dir / profile).unlink(missing_ok=True)
        except OSError:
            pass


_REQUEST_RESTART_HELPER = Path(
    os.environ.get("PIB_HERMES_REQUEST_RESTART", "/usr/local/sbin/pib-hermes-request-restart")
)


# OAuth/token writes land in auth.json immediately. Restarting the gateway for
# every credential sync is what SIGTERM'd live Messages runs (seen as the
# misleading browser "Unable to connect" error). Always defer — never bounce
# the process on the HTTP request path for these reasons.
_DEFER_ONLY_RESTART_PREFIXES = (
    "auth-provider-upsert:",
    "auth-provider-delete:",
    "auth-provider-",
    "oauth-",
    "token-refresh",
)


def _is_defer_only_restart_reason(reason: str) -> bool:
    text = (reason or "").strip().lower()
    if not text:
        return False
    return any(text.startswith(prefix) for prefix in _DEFER_ONLY_RESTART_PREFIXES)


def _restart_profile_detailed(profile: str, reason: str = "admin") -> dict:
    """Restart a profile only when idle.

    Returns:
      {restarted: bool, deferred: bool, busy: bool, reason: str}
    Never force-kills busy gateways — that aborts live Messages chats mid-run.

    Prefer the root helper (sudo) which can see client process names via ss and
    ignore pib-runtime keepalives. Fall back to in-process busy detection +
    polkit systemctl when the helper is unavailable.
    """
    if not _PROFILE_NAME_RE.match(profile or ""):
        return {"restarted": False, "deferred": False, "busy": False, "reason": "invalid-profile"}

    # OAuth credential sync: write-only on this request. Queue a deferred restart
    # for the 2-minute sweeper so live chats are never killed mid-tool.
    if _is_defer_only_restart_reason(reason):
        deferred = _mark_pending_restart(profile, f"defer-only:{reason}")
        return {
            "restarted": False,
            "deferred": deferred,
            "busy": True,
            "reason": f"defer-only:{reason}",
        }

    # Primary path: root helper with accurate busy detection (dport + process names).
    if _REQUEST_RESTART_HELPER.is_file():
        try:
            result = subprocess.run(
                ["sudo", "-n", str(_REQUEST_RESTART_HELPER), profile, reason[:80]],
                check=False,
                capture_output=True,
                text=True,
                timeout=90,
            )
            if result.returncode == 0:
                return {"restarted": True, "deferred": False, "busy": False, "reason": reason}
            if result.returncode == 2:
                return {"restarted": False, "deferred": True, "busy": True, "reason": reason}
            # Helper failed — queue deferred and do not hard-restart.
            deferred = _mark_pending_restart(profile, f"helper-failed:{reason}")
            return {
                "restarted": False,
                "deferred": deferred,
                "busy": False,
                "reason": f"helper-failed:{reason}",
            }
        except (OSError, subprocess.TimeoutExpired):
            deferred = _mark_pending_restart(profile, f"helper-error:{reason}")
            return {
                "restarted": False,
                "deferred": deferred,
                "busy": False,
                "reason": f"helper-error:{reason}",
            }

    # Fallback without helper: conservative busy check (may treat keepalives as busy).
    if _profile_is_busy(profile):
        deferred = _mark_pending_restart(profile, f"busy:{reason}")
        return {
            "restarted": False,
            "deferred": deferred,
            "busy": True,
            "reason": reason,
        }

    result = subprocess.run(
        ["/usr/bin/systemctl", "restart", f"hermes@{profile}.service"],
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode == 0:
        _clear_pending_restart(profile)
        return {"restarted": True, "deferred": False, "busy": False, "reason": reason}

    deferred = _mark_pending_restart(profile, f"restart-failed:{reason}")
    return {
        "restarted": False,
        "deferred": deferred,
        "busy": False,
        "reason": f"restart-failed:{reason}",
    }


def _restart_profile(profile: str, reason: str = "admin") -> bool:
    """Back-compat: True when the profile was restarted or a deferred restart was queued."""
    info = _restart_profile_detailed(profile, reason)
    return bool(info.get("restarted") or info.get("deferred"))


def _redact(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "********"
    return f"{value[:4]}...{value[-4:]}"


def _read_env_lines(path: Path) -> list[str]:
    if not path.exists():
        raise HTTPException(status_code=404, detail="profile env not found")
    return path.read_text(encoding="utf-8").splitlines()


def _parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in _read_env_lines(path):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _write_env(path: Path, values: dict[str, str], original_lines: list[str]) -> None:
    seen: set[str] = set()
    output: list[str] = []
    for line in original_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            output.append(line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in values:
            output.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            seen.add(key)
    for key in sorted(k for k in values if k not in seen):
        output.append(f"{key}={values[key]}")
    fd, tmp = tempfile.mkstemp(prefix=".env_", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("\n".join(output).rstrip() + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o660)
        os.replace(tmp, path)
    finally:
        try:
            if os.path.exists(tmp):
                os.unlink(tmp)
        except OSError:
            pass


def _cron_public(job: dict) -> dict:
    schedule = job.get("schedule_display") or job.get("schedule") or ""
    if isinstance(schedule, dict):
        schedule = schedule.get("display") or schedule.get("expr") or schedule.get("run_at") or json.dumps(schedule)
    state = job.get("state") or ("scheduled" if job.get("enabled", True) else "paused")
    if not job.get("enabled", True) and state != "completed":
        state = "paused"
    return {
        "id": job.get("id"),
        "name": job.get("name"),
        "prompt": job.get("prompt") or "",
        "schedule": str(schedule),
        "status": state,
        "last_run": job.get("last_run_at"),
        "next_run": job.get("next_run_at"),
        "raw": job,
    }




SAFE_PROFILE_FILES = {
    "SOUL.md": {"editable": True, "kind": "markdown"},
    "channel_directory.json": {"editable": True, "kind": "json"},
    "gateway_state.json": {"editable": False, "kind": "json"},
    "context_length_cache.yaml": {"editable": False, "kind": "yaml"},
    "models_dev_cache.json": {"editable": False, "kind": "json"},
    ".skills_prompt_snapshot.json": {"editable": False, "kind": "json"},
    "cron/jobs.json": {"editable": False, "kind": "json"},
}


def _safe_profile_file(profile: str, rel: str, *, require_editable: bool = False) -> tuple[Path, dict]:
    rel = (rel or "").strip().replace("\\", "/")
    meta = SAFE_PROFILE_FILES.get(rel)
    if not meta:
        raise HTTPException(status_code=400, detail="file is not exposed by the admin API")
    if require_editable and not meta.get("editable"):
        raise HTTPException(status_code=400, detail="file is read-only")
    target = (_profile_dir(profile) / rel).resolve()
    root = _profile_dir(profile).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(status_code=400, detail="invalid file path")
    return target, meta


def _profile_file_payload(profile: str, rel: str) -> dict:
    target, meta = _safe_profile_file(profile, rel)
    exists = target.exists()
    stat = target.stat() if exists else None
    return {
        "path": rel,
        "absolutePath": str(target),
        "exists": exists,
        "editable": bool(meta.get("editable")),
        "kind": meta.get("kind"),
        "sizeBytes": stat.st_size if stat else None,
        "updatedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat() if stat else None,
    }


def _next_profile_port() -> int:
    used: set[int] = set()
    for env_file in ENV_ROOT.glob("*.env"):
        try:
            values = _parse_env(env_file)
            port = int(values.get("API_SERVER_PORT", "0"))
            if port:
                used.add(port)
        except Exception:
            pass
    port = 8660
    while port in used:
        port += 1
    return port


def _caddy_block(profile: str, port: int) -> str:
    return (
        "\n\n"
        f"    # Hermes API server — proxy /profiles/{profile}/* to :{port}\n"
        f"    @{profile} path /profiles/{profile} /profiles/{profile}/*\n"
        f"    handle @{profile} {{\n"
        f"        uri strip_prefix /profiles/{profile}\n"
        f"        reverse_proxy 127.0.0.1:{port}\n"
        f"    }}\n"
    )


def _ensure_caddy_profile(profile: str, port: int) -> bool:
    caddy = Path("/etc/caddy/Caddyfile")
    caddy_text = caddy.read_text(encoding="utf-8")
    if f"/profiles/{profile}" in caddy_text:
        return False
    marker = "\n\thandle /health {" if "\n\thandle /health {" in caddy_text else "\n    handle /health {"
    if marker not in caddy_text:
        raise HTTPException(status_code=500, detail="Caddy insertion marker not found")
    caddy.write_text(caddy_text.replace(marker, _caddy_block(profile, port) + marker), encoding="utf-8")
    subprocess.run(["/usr/bin/sudo", "/usr/bin/caddy", "fmt", "--overwrite", str(caddy)], check=False, capture_output=True, text=True)
    subprocess.run(["/usr/bin/sudo", "/usr/bin/systemctl", "reload", "caddy"], check=False, capture_output=True, text=True)
    return True


def _copy_if_exists(src: Path, dest: Path, mode: int = 0o600) -> None:
    if src.exists() and not dest.exists():
        shutil.copy2(src, dest)
        os.chmod(dest, mode)

def _run_cron_script(profile: str, source: str, payload: dict | None = None) -> dict:
    env = os.environ.copy()
    home = str(_profile_dir(profile))
    env["HERMES_HOME"] = home
    env["HOME"] = home
    proc = subprocess.run(
        ["/var/lib/hermes/hermes-agent/venv/bin/python", "-c", source],
        cwd="/var/lib/hermes/hermes-agent",
        env=env,
        input=json.dumps(payload or {}),
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "cron command failed")[-1200:]
        raise HTTPException(status_code=502, detail=detail)
    try:
        return json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"invalid cron response: {exc}: {proc.stdout[-800:]}")


def _runtime_skill_items(external_dir: Path) -> list[dict]:
    items: list[dict] = []
    if not external_dir.exists() or not external_dir.is_dir():
        return items

    def visit(root: Path, prefix: str = "") -> None:
        try:
            entries = sorted(root.iterdir(), key=lambda item: item.name)
        except OSError:
            return
        for entry in entries:
            if entry.name.startswith("."):
                continue
            try:
                is_dir = entry.is_dir()
            except OSError:
                continue
            if not is_dir:
                continue
            rel = f"{prefix}/{entry.name}" if prefix else entry.name
            skill_file = entry / "SKILL.md"
            if skill_file.exists():
                try:
                    source = str(entry.resolve())
                except OSError:
                    source = str(entry)
                items.append({
                    "name": rel,
                    "path": str(entry),
                    "source": source,
                })
            else:
                visit(entry, rel)

    visit(external_dir)
    return items


@app.get("/profiles/{profile}/api/skills")
def list_runtime_skills(profile: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    cfg_path = _config_file(profile)
    if not cfg_path.exists():
        raise HTTPException(status_code=404, detail="config not found")
    config = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
    skills = config.get("skills") if isinstance(config, dict) else {}
    external_dirs = skills.get("external_dirs") if isinstance(skills, dict) else []
    if not isinstance(external_dirs, list):
        external_dirs = []

    items: list[dict] = []
    for raw_dir in external_dirs:
        if not isinstance(raw_dir, str) or not raw_dir.strip():
            continue
        base = Path(raw_dir.strip())
        for item in _runtime_skill_items(base):
            items.append({**item, "externalDir": str(base)})

    return {"skills": items}

@app.get("/profiles/{profile}/admin/skills")
def list_skills(profile: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    sdir = _skills_dir(profile)
    if not sdir.exists():
        return {"skills": []}
    items = []
    for entry in sorted(sdir.iterdir()):
        if not entry.is_dir():
            continue
        meta_path = None
        for candidate in ("skill.json", "manifest.json", "skill.yaml"):
            p = entry / candidate
            if p.exists():
                meta_path = p
                break
        description = None
        try:
            if meta_path and meta_path.suffix == ".json":
                description = json.loads(meta_path.read_text()).get("description")
        except Exception:
            description = None
        size = sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
        items.append({
            "name": entry.name,
            "path": str(entry.relative_to(PROFILES_ROOT)),
            "description": description,
            "fileCount": sum(1 for f in entry.rglob("*") if f.is_file()),
            "sizeBytes": size,
        })
    return {"skills": items}

@app.post("/profiles/{profile}/admin/skills")
async def upload_skill(profile: str, file: UploadFile = File(...), x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="upload must be a .zip")
    sdir = _skills_dir(profile)
    sdir.mkdir(parents=True, exist_ok=True)
    raw = await file.read()
    if len(raw) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="skill zip too large (50MB max)")
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="not a valid zip file")
    # Detect skill root: either single top-level dir, OR loose files (use filename stem)
    names = [n for n in zf.namelist() if not n.startswith("__MACOSX/")]
    if not names:
        raise HTTPException(status_code=400, detail="zip is empty")
    top_parts = {n.split("/", 1)[0] for n in names}
    if len(top_parts) == 1 and any(n.endswith("/") for n in names if n.startswith(next(iter(top_parts)))):
        skill_name = next(iter(top_parts))
        strip = skill_name + "/"
    else:
        skill_name = file.filename.rsplit(".", 1)[0]
        strip = ""
    if not SAFE_NAME.match(skill_name):
        raise HTTPException(status_code=400, detail=f"invalid skill name from zip: {skill_name}")
    target = sdir / skill_name
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for member in zf.namelist():
        if member.startswith("__MACOSX/"): continue
        # Path traversal guard
        rel = member[len(strip):] if strip and member.startswith(strip) else member
        if not rel or rel.endswith("/"):
            continue
        rel_path = Path(rel)
        if rel_path.is_absolute() or ".." in rel_path.parts:
            raise HTTPException(status_code=400, detail="zip contains path traversal")
        dest = target / rel_path
        try:
            dest.resolve().relative_to(target.resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="zip contains path traversal")
        dest.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(member) as src, open(dest, "wb") as out:
            out.write(src.read())
    # Restart when idle so skill packs load without killing live chats.
    restart = _restart_profile_detailed(profile, "skill-install")
    return JSONResponse({
        "installed": skill_name,
        "fileCount": sum(1 for _ in target.rglob("*")),
        "restarted": restart["restarted"],
        "deferred": restart["deferred"],
    })

@app.delete("/profiles/{profile}/admin/skills/{skill_name}")
def delete_skill(profile: str, skill_name: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    if not SAFE_NAME.match(skill_name):
        raise HTTPException(status_code=400, detail="invalid skill name")
    target = _skills_dir(profile) / skill_name
    if not target.exists():
        raise HTTPException(status_code=404, detail="skill not found")
    shutil.rmtree(target)
    restart = _restart_profile_detailed(profile, "skill-delete")
    return {
        "deleted": skill_name,
        "restarted": restart["restarted"],
        "deferred": restart["deferred"],
    }


@app.get("/profiles/{profile}/admin/cron")
def list_cron_jobs(profile: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    result = _run_cron_script(profile, """
import json
from cron.jobs import list_jobs
print(json.dumps({"jobs": list_jobs(include_disabled=True)}))
""")
    return {"jobs": [_cron_public(job) for job in result.get("jobs", [])]}


@app.post("/profiles/{profile}/admin/cron")
async def create_cron_job(profile: str, request: Request, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be an object")
    prompt = body.get("prompt")
    schedule = body.get("schedule")
    if not isinstance(prompt, str) or not prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    if not isinstance(schedule, str) or not schedule.strip():
        raise HTTPException(status_code=400, detail="schedule is required")
    allowed = {"name", "prompt", "schedule", "repeat", "deliver", "skill", "skills", "model", "provider", "base_url", "script", "context_from", "enabled_toolsets", "workdir", "no_agent"}
    payload = {k: v for k, v in body.items() if k in allowed}
    result = _run_cron_script(profile, """
import json, sys
from cron.jobs import create_job
payload = json.loads(sys.stdin.read() or '{}')
try:
    job = create_job(**payload)
    print(json.dumps({"job": job}))
except Exception as exc:
    print(json.dumps({"error": str(exc)}))
    raise SystemExit(2)
""", payload)
    return {"job": _cron_public(result["job"])}


@app.delete("/profiles/{profile}/admin/cron/{job_id}")
def delete_cron_job(profile: str, job_id: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    result = _run_cron_script(profile, """
import json, sys
from cron.jobs import remove_job
payload = json.loads(sys.stdin.read() or '{}')
removed = remove_job(payload['job_id'])
print(json.dumps({"removed": removed}))
""", {"job_id": job_id})
    if not result.get("removed"):
        raise HTTPException(status_code=404, detail="cron job not found")
    return result


@app.post("/profiles/{profile}/admin/cron/{job_id}/{action}")
def cron_job_action(profile: str, job_id: str, action: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    if action not in {"pause", "resume", "trigger"}:
        raise HTTPException(status_code=400, detail="action must be pause, resume, or trigger")
    script = """
import json, sys
from cron.jobs import pause_job, resume_job
from tools.cronjob_tools import cronjob
payload = json.loads(sys.stdin.read() or '{}')
action = payload['action']
job_id = payload['job_id']
if action == 'pause':
    job = pause_job(job_id, reason='Paused from Partners admin')
    print(json.dumps({"job": job}))
elif action == 'resume':
    job = resume_job(job_id)
    print(json.dumps({"job": job}))
else:
    print(cronjob(action='run', job_id=job_id))
"""
    result = _run_cron_script(profile, script, {"job_id": job_id, "action": action})
    if action in {"pause", "resume"}:
        if not result.get("job"):
            raise HTTPException(status_code=404, detail="cron job not found")
        return {"job": _cron_public(result["job"])}
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "failed to trigger job"))
    job = result.get("job")
    return {"job": _cron_public(job) if isinstance(job, dict) else job, "success": True}


@app.get("/profiles/{profile}/admin/env")
def read_env(profile: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    env_path = _env_file(profile)
    values = _parse_env(env_path)
    return {
        "path": str(env_path),
        "env": {
            key: {
                "is_set": bool(value),
                "redacted_value": _redact(value),
                "is_password": True,
                "advanced": key.startswith(("HERMES_", "API_", "SYSTEMD_")),
            }
            for key, value in sorted(values.items())
        },
    }


@app.patch("/profiles/{profile}/admin/env")
async def update_env(profile: str, request: Request, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be an object")
    env_path = _env_file(profile)
    lines = _read_env_lines(env_path)
    values = _parse_env(env_path)
    set_values = body.get("set") or {}
    unset_values = body.get("unset") or []
    if not isinstance(set_values, dict) or not isinstance(unset_values, list):
        raise HTTPException(status_code=400, detail="expected {set: object, unset: array}")
    key_re = re.compile(r"^[A-Z0-9_]+$")
    for key, value in set_values.items():
        if not isinstance(key, str) or not key_re.match(key):
            raise HTTPException(status_code=400, detail=f"invalid env key: {key}")
        values[key] = str(value)
    for key in unset_values:
        if not isinstance(key, str) or not key_re.match(key):
            raise HTTPException(status_code=400, detail=f"invalid env key: {key}")
        values.pop(key, None)
    _write_env(env_path, values, lines)
    restart = _restart_profile_detailed(profile, "env-update")
    return {
        "updated": True,
        "restarted": restart["restarted"],
        "deferred": restart["deferred"],
        "env": read_env(profile, x_api_key, authorization)["env"],
    }


_OAUTH_PROVIDER_RE = re.compile(r"^[a-z][a-z0-9._-]{0,63}$")


def _auth_json_path(profile: str) -> Path:
    return _profile_dir(profile) / "auth.json"


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".auth_", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    finally:
        try:
            if os.path.exists(tmp):
                os.unlink(tmp)
        except OSError:
            pass


def _oauth_tokens_from_provider_state(state: dict) -> tuple[str, str]:
    """Return (access_token, refresh_token) from Hermes-native or legacy flat state.

    Hermes auth.py expects ``providers.<id>.tokens.{access_token,refresh_token}``.
    Older PiB writes put those fields flat on the provider state; accept both
    when reading so status and migration stay accurate.
    """
    tokens = state.get("tokens") if isinstance(state.get("tokens"), dict) else {}
    access = str(tokens.get("access_token") or state.get("access_token") or "").strip()
    refresh = str(tokens.get("refresh_token") or state.get("refresh_token") or "").strip()
    return access, refresh


def _oauth_auth_mode_for_provider(provider: str, existing: dict) -> str:
    existing_mode = str(existing.get("auth_mode") or "").strip()
    if existing_mode:
        return existing_mode
    if provider == "openai-codex":
        return "chatgpt"
    if provider in {"xai-oauth", "nous", "copilot"}:
        return "oauth_device_code"
    return "oauth"


# Org OAuth is often synced only to the primary Hermes profile (pip). Specialists
# (Silas→seo, Blake→sales, Theo→theo, …) then fail with "No xAI OAuth credentials
# stored" even though Settings shows Connected. Share these providers fleet-wide.
_FLEET_SHARE_OAUTH_PROVIDERS = frozenset({"xai-oauth", "openai-codex", "nous", "copilot"})


def _share_oauth_provider_to_fleet(source_profile: str, provider: str, state: dict) -> list[str]:
    """Copy OAuth provider state to every other Hermes profile auth.json (no mid-request restarts)."""
    if provider not in _FLEET_SHARE_OAUTH_PROVIDERS:
        return []
    flag = os.environ.get("PIB_FLEET_SHARE_OAUTH", "1").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        return []
    if not isinstance(state, dict) or not state:
        return []
    updated: list[str] = []
    try:
        profile_dirs = list(PROFILES_ROOT.iterdir())
    except OSError:
        return []
    for profile_dir in profile_dirs:
        if not profile_dir.is_dir():
            continue
        name = profile_dir.name
        if name == source_profile or not _PROFILE_NAME_RE.match(name):
            continue
        auth_path = profile_dir / "auth.json"
        store: dict = {}
        if auth_path.exists():
            try:
                loaded = json.loads(auth_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    store = loaded
            except Exception:
                store = {}
        providers = store.get("providers")
        if not isinstance(providers, dict):
            providers = {}
            store["providers"] = providers
        # Deep-ish copy so nested tokens are not shared by reference.
        providers[provider] = json.loads(json.dumps(state))
        store["providers"] = providers
        try:
            _atomic_write_json(auth_path, store)
        except OSError:
            continue
        # Defer restart only — never bounce busy gateways from fleet share.
        _mark_pending_restart(name, f"fleet-oauth-share:{provider}")
        updated.append(name)
    return updated


def _sync_oauth_credential_pool(
    store: dict,
    provider: str,
    access_token: str,
    refresh_token: str,
    last_refresh: str,
) -> None:
    """Mirror singleton OAuth tokens into credential_pool for Hermes runtime.

    Codex (and xAI OAuth after pool load) select from credential_pool when
    present. Keep the device_code singleton entry in sync with providers.*.tokens
    so a PiB resync actually becomes the live runtime credential.
    """
    pool = store.get("credential_pool")
    if not isinstance(pool, dict):
        pool = {}
        store["credential_pool"] = pool
    entries = pool.get(provider)
    if not isinstance(entries, list):
        entries = []
        pool[provider] = entries

    base_url = None
    if provider == "openai-codex":
        base_url = "https://chatgpt.com/backend-api/codex"
    elif provider == "xai-oauth":
        base_url = "https://api.x.ai/v1"

    updated = False
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        source = str(entry.get("source") or "")
        if source != "device_code":
            continue
        entry["access_token"] = access_token
        if refresh_token:
            entry["refresh_token"] = refresh_token
        else:
            entry.pop("refresh_token", None)
        entry["auth_type"] = "oauth"
        entry["last_refresh"] = last_refresh
        entry["last_status"] = None
        entry["last_status_at"] = None
        entry["last_error_code"] = None
        entry["last_error_reason"] = None
        entry["last_error_message"] = None
        entry["last_error_reset_at"] = None
        if base_url and not entry.get("base_url"):
            entry["base_url"] = base_url
        updated = True
        break

    if not updated:
        entries.append(
            {
                "id": f"pib-{provider[:12]}",
                "label": provider,
                "source": "device_code",
                "auth_type": "oauth",
                "priority": 0,
                "access_token": access_token,
                "last_refresh": last_refresh,
                "last_status": None,
                "last_status_at": None,
                "last_error_code": None,
                "last_error_reason": None,
                "last_error_message": None,
                "last_error_reset_at": None,
                **({"base_url": base_url} if base_url else {}),
                **({"refresh_token": refresh_token} if refresh_token else {}),
            }
        )
    pool[provider] = entries


@app.get("/profiles/{profile}/admin/auth/providers")
def list_auth_providers(profile: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    """List configured OAuth providers (masked) from the profile auth.json."""
    _require_auth(profile, x_api_key, authorization)
    path = _auth_json_path(profile)
    if not path.exists():
        return {"providers": {}, "path": str(path), "exists": False}
    try:
        store = json.loads(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"invalid auth.json: {exc}")
    providers = store.get("providers") if isinstance(store, dict) else {}
    if not isinstance(providers, dict):
        providers = {}
    masked = {}
    for name, state in providers.items():
        if not isinstance(state, dict):
            continue
        access, refresh = _oauth_tokens_from_provider_state(state)
        tokens_obj = state.get("tokens") if isinstance(state.get("tokens"), dict) else None
        refresh_required = name != "xai-oauth"
        hermes_shape = bool(tokens_obj and access and (refresh or not refresh_required))
        masked[name] = {
            "configured": bool(access and (refresh or not refresh_required)),
            "has_access_token": bool(access),
            "has_refresh_token": bool(refresh),
            "hermes_shape": hermes_shape,
            "usable": hermes_shape,
            "hint": (f"{access[:4]}…{access[-4:]}" if len(access) > 8 else ("…" if access else None)),
            "updated_at": state.get("updated_at") or state.get("last_refresh"),
            "auth_mode": state.get("auth_mode"),
            "source": state.get("source"),
        }
    return {"providers": masked, "path": str(path), "exists": True}


@app.put("/profiles/{profile}/admin/auth/providers/{provider}")
async def upsert_auth_provider(
    profile: str,
    provider: str,
    request: Request,
    x_api_key: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """Merge OAuth tokens into profile auth.json for a Hermes provider id.

    Body: {access_token, refresh_token, expires_in?, token_type?, id_token?, scope?}
    Used by Partners in Biz after a successful device-code OAuth so the
    gateway can use SuperGrok / Codex / etc. without a manual CLI login.

    Hermes expects the nested shape used by hermes_cli.auth:

        providers.<provider> = {
          "tokens": {"access_token", "refresh_token", "token_type"?},
          "last_refresh": ISO-8601 Z,
          "auth_mode": "chatgpt" | "oauth_device_code" | ...,
          ...
        }

    Flat access_token/refresh_token at the provider root are rejected by Hermes
    as "OAuth state is missing tokens".
    """
    _require_auth(profile, x_api_key, authorization)
    if not _OAUTH_PROVIDER_RE.match(provider or ""):
        raise HTTPException(status_code=400, detail="invalid provider id")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be an object")
    access_token = body.get("access_token")
    refresh_token = body.get("refresh_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise HTTPException(status_code=400, detail="access_token is required")
    refresh_required = provider != "xai-oauth"
    if refresh_required and (not isinstance(refresh_token, str) or not refresh_token.strip()):
        raise HTTPException(status_code=400, detail="refresh_token is required")
    if refresh_token is not None and not isinstance(refresh_token, str):
        raise HTTPException(status_code=400, detail="refresh_token must be a string")
    if len(access_token) > 16384 or (isinstance(refresh_token, str) and len(refresh_token) > 16384):
        raise HTTPException(status_code=400, detail="token too long")

    path = _auth_json_path(profile)
    store: dict = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                store = loaded
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"invalid auth.json: {exc}")
    providers = store.get("providers")
    if not isinstance(providers, dict):
        providers = {}
        store["providers"] = providers
    existing = providers.get(provider) if isinstance(providers.get(provider), dict) else {}
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    expires_in = body.get("expires_in")
    token_type = str(body.get("token_type") or "Bearer").strip() or "Bearer"
    access = access_token.strip()
    refresh = refresh_token.strip() if isinstance(refresh_token, str) else ""

    # Preserve non-token metadata, but force Hermes-native token nesting.
    state = {k: v for k, v in existing.items() if k not in {
        "access_token", "refresh_token", "token_type", "tokens", "last_auth_error",
    }}
    tokens: dict = {
        "access_token": access,
        "token_type": token_type,
    }
    if refresh:
        tokens["refresh_token"] = refresh
    if isinstance(body.get("id_token"), str) and body["id_token"].strip():
        tokens["id_token"] = body["id_token"].strip()
    if isinstance(body.get("scope"), str) and body["scope"].strip():
        tokens["scope"] = body["scope"].strip()
        state["scope"] = body["scope"].strip()
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        expires_at = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + float(expires_in),
            tz=timezone.utc,
        ).isoformat().replace("+00:00", "Z")
        tokens["expires_at"] = expires_at
        state["expires_at"] = expires_at

    state["tokens"] = tokens
    state["last_refresh"] = now
    state["updated_at"] = now
    state["auth_mode"] = _oauth_auth_mode_for_provider(provider, existing)
    state["source"] = "pib-oauth"
    # Clear prior terminal auth markers so Hermes retries the new pair.
    state.pop("last_auth_error", None)

    providers[provider] = state
    store["providers"] = providers
    _sync_oauth_credential_pool(store, provider, access, refresh, now)
    _atomic_write_json(path, store)
    # Propagate to specialist profiles (seo/sales/theo/…) so Silas etc. can use SuperGrok.
    fleet_shared = _share_oauth_provider_to_fleet(profile, provider, state)
    # Tokens are on disk immediately; only bounce the gateway when it is idle so
    # live Messages runs are never SIGTERM'd mid-tool by OAuth credential sync.
    restart = _restart_profile_detailed(profile, f"auth-provider-upsert:{provider}")
    return {
        "updated": True,
        "provider": provider,
        "restarted": restart["restarted"],
        "deferred": restart["deferred"],
        "busy": restart["busy"],
        "path": str(path),
        "hermes_shape": True,
        "fleet_shared": fleet_shared,
        "hint": f"{access[:4]}…{access[-4:]}" if len(access) > 8 else "…",
    }


@app.delete("/profiles/{profile}/admin/auth/providers/{provider}")
def delete_auth_provider(
    profile: str,
    provider: str,
    x_api_key: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
):
    _require_auth(profile, x_api_key, authorization)
    if not _OAUTH_PROVIDER_RE.match(provider or ""):
        raise HTTPException(status_code=400, detail="invalid provider id")
    path = _auth_json_path(profile)
    if not path.exists():
        return {"deleted": False, "provider": provider, "reason": "auth.json missing"}
    try:
        store = json.loads(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"invalid auth.json: {exc}")
    providers = store.get("providers") if isinstance(store, dict) else {}
    if not isinstance(providers, dict) or provider not in providers:
        return {"deleted": False, "provider": provider, "reason": "provider not configured"}
    providers.pop(provider, None)
    store["providers"] = providers
    _atomic_write_json(path, store)
    restart = _restart_profile_detailed(profile, f"auth-provider-delete:{provider}")
    return {
        "deleted": True,
        "provider": provider,
        "restarted": restart["restarted"],
        "deferred": restart["deferred"],
    }


@app.get("/profiles/{profile}/admin/config")
def read_config(profile: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    cfg_path = _config_file(profile)
    if not cfg_path.exists():
        raise HTTPException(status_code=404, detail="config not found")
    config = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
    return {"path": str(cfg_path), "config": config}


@app.put("/profiles/{profile}/admin/config")
async def update_config(profile: str, request: Request, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    body = await request.json()
    config = body.get("config") if isinstance(body, dict) and "config" in body else body
    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="config must be a JSON object")
    cfg_path = _config_file(profile)
    if not cfg_path.exists():
        raise HTTPException(status_code=404, detail="config not found")
    rendered = yaml.safe_dump(config, sort_keys=False, allow_unicode=False)
    fd, tmp = tempfile.mkstemp(prefix=".config_", suffix=".yaml", dir=str(cfg_path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(rendered)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, cfg_path)
    finally:
        try:
            if os.path.exists(tmp):
                os.unlink(tmp)
        except OSError:
            pass
    restart = _restart_profile_detailed(profile, "config-update")
    return {
        "updated": True,
        "restarted": restart["restarted"],
        "deferred": restart["deferred"],
        "path": str(cfg_path),
        "config": config,
    }


@app.get("/profiles/{profile}/admin/files")
def list_profile_files(profile: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    return {"files": [_profile_file_payload(profile, rel) for rel in sorted(SAFE_PROFILE_FILES.keys())]}


@app.get("/profiles/{profile}/admin/files/{file_path:path}")
def read_profile_file(profile: str, file_path: str, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    target, meta = _safe_profile_file(profile, file_path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="file not found")
    content = target.read_text(encoding="utf-8", errors="replace")
    return {**_profile_file_payload(profile, file_path), "content": content, "editable": bool(meta.get("editable"))}


@app.put("/profiles/{profile}/admin/files/{file_path:path}")
async def write_profile_file(profile: str, file_path: str, request: Request, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    target, meta = _safe_profile_file(profile, file_path, require_editable=True)
    body = await request.json()
    content = body.get("content") if isinstance(body, dict) else None
    if not isinstance(content, str):
        raise HTTPException(status_code=400, detail="content must be a string")
    if len(content.encode("utf-8")) > 512 * 1024:
        raise HTTPException(status_code=413, detail="file content too large")
    if meta.get("kind") == "json":
        try:
            json.loads(content or "{}")
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"invalid JSON: {exc}")
    fd, tmp = tempfile.mkstemp(prefix=".profile_file_", suffix=".tmp", dir=str(target.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            if not content.endswith("\n"):
                handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, target)
    finally:
        try:
            if os.path.exists(tmp):
                os.unlink(tmp)
        except OSError:
            pass
    restart = _restart_profile_detailed(profile, f"profile-file:{file_path}")
    return {
        "updated": True,
        "restarted": restart["restarted"],
        "deferred": restart["deferred"],
        **_profile_file_payload(profile, file_path),
    }


def _existing_profile_registration(
    target_profile: str,
    *,
    profiles_root: Path = PROFILES_ROOT,
    env_root: Path = ENV_ROOT,
) -> dict:
    if not SAFE_NAME.match(target_profile) or target_profile in {"admin", "health"}:
        raise HTTPException(status_code=400, detail="invalid agentId")
    profile_dir = profiles_root / target_profile
    env_path = env_root / f"{target_profile}.env"
    if not profile_dir.is_dir() or not env_path.is_file():
        raise HTTPException(status_code=404, detail="profile not found")

    env = _parse_env(env_path)
    api_key = str(env.get("API_SERVER_KEY") or "").strip()
    raw_port = str(env.get("API_SERVER_PORT") or "").strip()
    if not api_key or not raw_port.isdigit():
        raise HTTPException(status_code=409, detail="profile registration is incomplete")

    return {
        "agentId": target_profile,
        "baseUrl": f"https://hermes-api.partnersinbiz.online/profiles/{target_profile}",
        "apiKey": api_key,
        "port": int(raw_port),
    }


@app.get("/profiles/{profile}/admin/profiles/{target_profile}/registration")
async def existing_profile_registration(
    profile: str,
    target_profile: str,
    x_api_key: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
):
    _require_auth(profile, x_api_key, authorization)
    return _existing_profile_registration(target_profile)


@app.post("/profiles/{profile}/admin/profiles")
async def provision_profile(profile: str, request: Request, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be an object")
    new_profile = str(body.get("agentId") or "").strip().lower()
    if not SAFE_NAME.match(new_profile) or new_profile in {"admin", "health"}:
        raise HTTPException(status_code=400, detail="invalid agentId")
    profile_dir = _profile_dir(new_profile)
    if profile_dir.exists():
        raise HTTPException(status_code=409, detail="profile already exists")
    name = str(body.get("name") or new_profile.title()).strip()
    role = str(body.get("role") or "Specialist").strip()
    persona = str(body.get("persona") or f"{name} supports Partners in Biz with focused specialist work.").strip()
    model = str(body.get("defaultModel") or "gpt-5.5").strip()
    provider = str(body.get("provider") or "openai-codex").strip()
    port = int(body.get("port") or _next_profile_port())
    api_key = secrets.token_urlsafe(32)

    profile_dir.mkdir(parents=True, mode=0o700)
    (profile_dir / "skills").mkdir(mode=0o700, exist_ok=True)
    (profile_dir / "sessions").mkdir(mode=0o700, exist_ok=True)
    (profile_dir / "cron" / "output").mkdir(parents=True, mode=0o700, exist_ok=True)

    template_config = _config_file(profile)
    config = yaml.safe_load(template_config.read_text(encoding="utf-8")) if template_config.exists() else {}
    if not isinstance(config, dict):
        config = {}
    workspace = Path(str(body.get("workspacePath") or PARTNERS_WEB_WORKSPACE))
    if not workspace.is_absolute():
        raise HTTPException(status_code=400, detail="workspacePath must be absolute")
    if not workspace.exists():
        raise HTTPException(status_code=500, detail=f"workspace path does not exist: {workspace}")
    current_model = config.get("model") if isinstance(config.get("model"), dict) else {}
    config["model"] = {**current_model, "default": model, "provider": provider}
    terminal = config.get("terminal") if isinstance(config.get("terminal"), dict) else {}
    terminal["cwd"] = str(workspace)
    config["terminal"] = terminal
    (profile_dir / "config.yaml").write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=False), encoding="utf-8")
    os.chmod(profile_dir / "config.yaml", 0o600)

    soul = str(body.get("soul") or f"# {name} — Partners in Biz {role}\n\nYou are **{name}**, a Partners in Biz {role} agent built by Peet Stander.\n\n## Behaviour\n- Identify as {name}.\n- Work through the Partners in Biz platform context.\n- Keep durable knowledge in the Cowork wiki when useful.\n").strip() + "\n"
    (profile_dir / "SOUL.md").write_text(soul, encoding="utf-8")
    os.chmod(profile_dir / "SOUL.md", 0o600)

    _copy_if_exists(_profile_dir(profile) / "auth.json", profile_dir / "auth.json")
    _copy_if_exists(_profile_dir(profile) / "channel_directory.json", profile_dir / "channel_directory.json")

    source_env = _parse_env(_env_file(profile))
    env_values = {
        "API_SERVER_ENABLED": "true",
        "API_SERVER_HOST": "127.0.0.1",
        "API_SERVER_PORT": str(port),
        "API_SERVER_KEY": api_key,
        "API_SERVER_MODEL_NAME": new_profile,
        "AI_API_KEY": source_env.get("AI_API_KEY", ""),
        "GEMINI_API_KEY": source_env.get("GEMINI_API_KEY", ""),
        "PIB_API_BASE": source_env.get("PIB_API_BASE", "https://partnersinbiz.online/api/v1"),
    }
    env_path = _env_file(new_profile)
    _write_env(env_path, env_values, [])
    try:
        shutil.chown(env_path, user="root", group="hermes")
    except Exception:
        pass
    os.chmod(env_path, 0o660)

    override_path = _write_profile_service_override(new_profile, workspace)
    caddy_changed = _ensure_caddy_profile(new_profile, port)
    subprocess.run(["/usr/bin/systemctl", "enable", f"hermes@{new_profile}.service"], check=False, capture_output=True, text=True)
    restart = _restart_profile_detailed(new_profile, "profile-provision")
    return {
        "agentId": new_profile,
        "name": name,
        "role": role,
        "persona": persona,
        "defaultModel": model,
        "provider": provider,
        "port": port,
        "baseUrl": f"https://hermes-api.partnersinbiz.online/profiles/{new_profile}",
        "apiKey": api_key,
        "workspacePath": str(workspace),
        "systemdOverride": override_path,
        "restarted": restart["restarted"],
        "deferred": restart["deferred"],
        "caddyChanged": caddy_changed,
    }


VAULT_ROOT = Path("/var/lib/hermes/cowork-wiki")
SAFE_NOTE_PATH = re.compile(r"^[A-Za-z0-9._/ -]+\.md$")
SAFE_KNOWLEDGE_SECTIONS = {"index", "wiki", "raw", "logs"}


def _knowledge_base(scope: str, agent: Optional[str]) -> Path:
    if scope == "shared":
        return VAULT_ROOT / "shared"
    if scope == "agent":
        if not agent or not SAFE_NAME.match(agent):
            raise HTTPException(status_code=400, detail="valid agent is required")
        return VAULT_ROOT / "agents" / agent
    raise HTTPException(status_code=400, detail="scope must be shared or agent")


def _knowledge_root(scope: str, agent: Optional[str], section: str) -> Path:
    if section not in SAFE_KNOWLEDGE_SECTIONS:
        raise HTTPException(status_code=400, detail="section must be index, wiki, raw, or logs")
    base = _knowledge_base(scope, agent)
    if section == "index":
        return base
    return base / section


def _safe_note_path(root: Path, rel: str) -> Path:
    rel = (rel or "").strip().replace("\\", "/")
    if not rel or rel.startswith("/") or ".." in Path(rel).parts or not SAFE_NOTE_PATH.match(rel):
        raise HTTPException(status_code=400, detail="invalid note path")
    target = (root / rel).resolve()
    root_resolved = root.resolve()
    if root_resolved not in target.parents and target != root_resolved:
        raise HTTPException(status_code=400, detail="invalid note path")
    return target


def _utc_iso(timestamp: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def _item_payload(path: Path, root: Path):
    st = path.stat()
    return {
        "path": path.relative_to(root).as_posix(),
        "name": path.name,
        "type": "dir" if path.is_dir() else "file",
        "sizeBytes": None if path.is_dir() else st.st_size,
        "updatedAt": _utc_iso(st.st_mtime),
    }


@app.get("/profiles/{profile}/admin/knowledge")
def read_knowledge(
    profile: str,
    scope: str,
    section: str = "wiki",
    agent: Optional[str] = None,
    path: Optional[str] = None,
    x_api_key: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
):
    _require_auth(profile, x_api_key, authorization)
    root = _knowledge_root(scope, agent, section)
    root.mkdir(parents=True, exist_ok=True)
    if path:
        note_path = _safe_note_path(root, path)
        if not note_path.exists() or not note_path.is_file():
            raise HTTPException(status_code=404, detail="note not found")
        st = note_path.stat()
        return {
            "path": note_path.relative_to(root).as_posix(),
            "name": note_path.name,
            "content": note_path.read_text(encoding="utf-8"),
            "sizeBytes": st.st_size,
            "updatedAt": _utc_iso(st.st_mtime),
        }
    items = []
    for child in sorted(root.rglob("*")):
        if child.name.startswith("."):
            continue
        if child.is_dir() or child.suffix.lower() == ".md":
            items.append(_item_payload(child, root))
    if section == "index":
        index_path = root / "index.md"
        items = [_item_payload(index_path, root)] if index_path.exists() else []
    return {"scope": scope, "section": section, "agent": agent, "root": str(root), "items": items}


@app.post("/profiles/{profile}/admin/knowledge")
async def write_knowledge(
    profile: str,
    request: Request,
    x_api_key: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
):
    _require_auth(profile, x_api_key, authorization)
    body = await request.json()
    scope = body.get("scope")
    agent = body.get("agent")
    section = body.get("section") or "wiki"
    rel = body.get("path")
    content = body.get("content")
    if not isinstance(content, str):
        raise HTTPException(status_code=400, detail="content must be a string")
    root = _knowledge_root(scope, agent, section)
    root.mkdir(parents=True, exist_ok=True)
    if section == "index":
        rel = "index.md"
    note_path = _safe_note_path(root, rel)
    note_path.parent.mkdir(parents=True, exist_ok=True)
    note_path.write_text(content, encoding="utf-8")

    committed = False
    commit_error = None
    try:
        subprocess.run(["/usr/bin/git", "-C", str(VAULT_ROOT), "add", str(note_path)], check=True, capture_output=True, text=True)
        msg = f"knowledge: update {note_path.relative_to(VAULT_ROOT).as_posix()}"
        result = subprocess.run(["/usr/bin/git", "-C", str(VAULT_ROOT), "commit", "-m", msg], check=False, capture_output=True, text=True)
        committed = result.returncode == 0
        if result.returncode != 0 and "nothing to commit" not in (result.stdout + result.stderr).lower():
            commit_error = (result.stderr or result.stdout).strip()[:500]
    except Exception as exc:
        commit_error = str(exc)[:500]
    return {"path": note_path.relative_to(root).as_posix(), "committed": committed, "commitError": commit_error}


COWORK_ROOT = Path("/var/lib/hermes/Cowork")
PARTNERS_WORKSPACE_NAME = "Partners in Biz \N{EM DASH} Client Growth"
PARTNERS_WEB_WORKSPACE = COWORK_ROOT / PARTNERS_WORKSPACE_NAME / "partnersinbiz-web"
WORKSPACE_SUBDIRS = ["docs", "briefs", "assets", "marketing", "research", "operations", "deliverables", "inbox", "archive"]
PROFILE_RUNTIME_PATH = "/var/lib/hermes/.local/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"


def _systemd_quote(value: str) -> str:
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def _write_profile_service_override(profile: str, workspace: Path) -> str:
    """Best-effort systemd drop-in for profile runtime niceties.

    The profile service already reads its env from /etc/hermes/profiles and
    Hermes itself reads terminal.cwd from config.yaml, so a per-profile drop-in
    is useful but not required. Some hardened sidecar deployments can write
    /etc/hermes and /etc/caddy but not /etc/systemd/system; do not make client
    workspace provisioning fail just because this optional drop-in cannot be
    written.
    """
    dropin_dir = Path(f"/etc/systemd/system/hermes@{profile}.service.d")
    workspace_text = str(workspace)
    override_text = f"""[Service]
WorkingDirectory={workspace_text}
Environment={_systemd_quote(f"TERMINAL_CWD={workspace_text}")}
Environment={_systemd_quote("HERMES_YOLO_MODE=1")}
Environment={_systemd_quote(f"PATH={PROFILE_RUNTIME_PATH}")}
"""
    try:
        dropin_dir.mkdir(parents=True, exist_ok=True)
        override = dropin_dir / "override.conf"
        if not override.exists() or override.read_text(encoding="utf-8") != override_text:
            override.write_text(override_text, encoding="utf-8")
            subprocess.run(["/usr/bin/systemctl", "daemon-reload"], check=False, capture_output=True, text=True)
        return str(override)
    except OSError as exc:
        return f"skipped optional systemd drop-in: {exc}"


def _validate_client_name(value: str) -> str:
    name = (value or "").strip()
    if not name or "/" in name or "\\" in name or ".." in Path(name).parts:
        raise HTTPException(status_code=400, detail="invalid clientName")
    return name


def _render_client_index(client_name: str, domain: str, org_id: str) -> str:
    return f"# {client_name} - Knowledge Index\n\norg_id: {org_id}\nslug: {domain}\nplatform: https://partnersinbiz.online\n\n## Wiki Articles\n(none yet)\n\n## Raw Sources\n(none yet)\n"


def _render_client_hot(client_name: str, domain: str, org_id: str) -> str:
    return f"# {client_name} - Hot Cache\n\norg_id: {org_id}\nslug: {domain}\n\nNew client workspace provisioned. Add current priorities, brand facts, access notes, and active work here as onboarding develops.\n"


def _render_client_claude(client_name: str, domain: str, agent_name: str, workspace: Path, agent_root: Path) -> str:
    return f"""# {client_name} - Project Instructions

You are **{agent_name}**, the dedicated AI agent for **{client_name}** inside Peet Stander's Cowork workspace. Never say you are Codex, Claude, Hermes Agent, or any other generic AI model - you are {agent_name}.

You assist with strategy, research, planning, writing, content, operations, documentation, execution support, and structured follow-through for the {client_name} project.

Your working directory is `{workspace}`.

## Knowledge Base Domain

Your knowledge base lives at: `{agent_root}`

- On session start, read the hot cache from `{agent_root}/wiki/hot.md`
- When you need deeper context: read hot.md first, then index.md, then individual wiki pages
- When you learn something worth keeping, write to `{agent_root}/wiki/<topic>.md`
- At the end of sessions, write summaries to `{agent_root}/logs/YYYY-MM-DD.md`
- Update `{agent_root}/index.md` when you add new content
- For cross-domain knowledge, write to `/var/lib/hermes/Cowork/Cowork/shared/wiki/`

## Workspace Organisation

Everything you create goes inside `{workspace}`. Never save files outside the workspace.

- docs/ - documentation, strategy notes, specs, and durable references
- briefs/ - task briefs, campaign briefs, requirements, stakeholder instructions
- assets/ - images, brand files, media, design source files
- marketing/ - content plans, copy, social/email/web campaigns, publishing calendars
- research/ - market/person/background research and source synthesis
- operations/ - admin, SOPs, checklists, process docs, setup notes
- deliverables/ - final outputs to send, publish, or hand over
- inbox/ - unsorted incoming material to triage
- archive/ - stale/superseded material retained for reference

## Behaviour

- Be direct, helpful, and action-oriented
- Peet acts as the board - high-level goals and direction. You execute and recommend
- Do not guess project facts. If the relevant instructions or Obsidian notes can be read, read them first
- The Hermes profile for this project is `{domain}`
"""


def _write_if_missing(target: Path, content: str, mode: int = 0o660) -> bool:
    if target.exists():
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    os.chmod(target, mode)
    return True


def _upsert_line(path: Path, line: str, before_marker: str | None = None) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if line in existing:
        return False
    if before_marker and before_marker in existing:
        existing = existing.replace(before_marker, f"{line}\n{before_marker}", 1)
    else:
        existing = existing.rstrip() + "\n" + line + "\n"
    path.write_text(existing, encoding="utf-8")
    return True


def _configure_profile_workspace(profile: str, workspace: Path, soul: str | None) -> dict:
    profile_dir = _profile_dir(profile)
    if not profile_dir.exists():
        return {"configured": False, "reason": "profile does not exist"}

    changed: list[str] = []
    if soul:
        soul_path = profile_dir / "SOUL.md"
        if _write_if_missing(soul_path, soul, 0o600):
            changed.append(str(soul_path))

    cfg_path = _config_file(profile)
    if cfg_path.exists():
        config = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        if not isinstance(config, dict):
            config = {}
        terminal = config.get("terminal") if isinstance(config.get("terminal"), dict) else {}
        if terminal.get("cwd") != str(workspace):
            terminal["cwd"] = str(workspace)
            config["terminal"] = terminal
            cfg_path.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=False), encoding="utf-8")
            os.chmod(cfg_path, 0o600)
            changed.append(str(cfg_path))

    override_path = _write_profile_service_override(profile, workspace)
    changed.append(str(override_path))

    restart = _restart_profile_detailed(profile, "workspace-configure")
    return {
        "configured": True,
        "changed": changed,
        "restarted": restart["restarted"],
        "deferred": restart["deferred"],
    }



def _safe_child_path(root: Path, value: str, label: str) -> Path:
    candidate = Path(value)
    try:
        resolved_root = root.resolve()
        resolved_candidate = candidate.resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"invalid {label}: {exc}")
    if resolved_candidate != resolved_root and resolved_root not in resolved_candidate.parents:
        raise HTTPException(status_code=400, detail=f"{label} must stay under {resolved_root}")
    return candidate


def _safe_workspace_folders(value) -> tuple[list[str], list[str]]:
    warnings: list[str] = []
    folders: list[str] = []
    source = value if isinstance(value, list) else WORKSPACE_SUBDIRS
    for raw in source:
        if not isinstance(raw, str):
            warnings.append("ignored non-string workspace folder")
            continue
        item = raw.strip().strip("/")
        parts = Path(item).parts
        if not item or Path(item).is_absolute() or ".." in parts:
            warnings.append(f"ignored unsafe workspace folder: {raw}")
            continue
        if item not in folders:
            folders.append(item)
    return folders, warnings


def _safe_project_identity(value, label: str) -> str:
    identity = str(value or "").strip()
    if (
        not identity
        or len(identity) > 128
        or identity in {".", ".."}
        or not SAFE_NAME.fullmatch(identity)
    ):
        raise HTTPException(status_code=400, detail=f"invalid {label}")
    return identity


def _resolved_child(root: Path, candidate: Path, label: str) -> Path:
    try:
        resolved_root = root.resolve()
        resolved_candidate = candidate.resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"invalid {label}: {exc}")
    if resolved_candidate == resolved_root or resolved_root not in resolved_candidate.parents:
        raise HTTPException(status_code=400, detail=f"{label} must stay under {resolved_root}")
    return resolved_candidate


def _provision_project_folder(body: dict, *, cowork_root: Path = COWORK_ROOT) -> dict:
    """Create the idempotent client-manager project contract on the canonical VPS.

    Browser callers never supply a project relative path or template. The path is
    derived from the server-validated project id and is always
    ``projects/<projectId>`` under an already registered Cowork workspace.
    """
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be an object")

    project_id = _safe_project_identity(body.get("projectId"), "projectId")
    org_id = _safe_project_identity(body.get("orgId"), "orgId")
    workspace_id = _safe_project_identity(body.get("workspaceId"), "workspaceId")
    raw_workspace = str(body.get("workspacePath") or "").strip()
    workspace_candidate = Path(raw_workspace)
    if not raw_workspace or not workspace_candidate.is_absolute():
        raise HTTPException(status_code=400, detail="workspacePath must be absolute")

    root = cowork_root.resolve()
    workspace = _resolved_child(root, workspace_candidate, "workspacePath")
    if not workspace.exists() or not workspace.is_dir():
        raise HTTPException(status_code=404, detail="Workspace does not exist")

    workspace_manifest_path = workspace / ".pib-workspace.json"
    if not workspace_manifest_path.exists() or workspace_manifest_path.is_symlink():
        raise HTTPException(status_code=409, detail="registered Workspace manifest is required")
    try:
        workspace_manifest = json.loads(workspace_manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=409, detail=f"registered Workspace manifest is invalid: {exc}")
    manifest_vps_path = workspace_manifest.get("vpsPath") if isinstance(workspace_manifest, dict) else None
    try:
        manifest_workspace = Path(manifest_vps_path).resolve() if isinstance(manifest_vps_path, str) else None
    except OSError:
        manifest_workspace = None
    if (
        not isinstance(workspace_manifest, dict)
        or workspace_manifest.get("orgId") != org_id
        or workspace_manifest.get("workspaceId") != workspace_id
        or manifest_workspace != workspace
    ):
        raise HTTPException(status_code=409, detail="registered Workspace manifest identity conflict")

    projects_candidate = workspace / "projects"
    projects = _resolved_child(workspace, projects_candidate, "projects path")
    if projects_candidate.exists() and projects_candidate.is_symlink():
        # Even an in-root symlink makes the canonical ownership boundary unclear.
        raise HTTPException(status_code=400, detail="projects path must not be a symlink")
    projects.mkdir(parents=True, exist_ok=True)

    project_candidate = projects / project_id
    project = _resolved_child(workspace, project_candidate, "project path")
    if project_candidate.exists() and project_candidate.is_symlink():
        raise HTTPException(status_code=400, detail="project path must not be a symlink")

    directories_created: list[str] = []
    directories_preserved: list[str] = []
    for directory in [project, *(project / subdir for subdir in WORKSPACE_SUBDIRS)]:
        resolved_directory = _resolved_child(workspace, directory, "project directory")
        if directory.exists() and directory.is_symlink():
            raise HTTPException(status_code=400, detail="project directories must not be symlinks")
        existed = directory.exists()
        directory.mkdir(parents=True, exist_ok=True)
        if not directory.is_dir() or directory.resolve() != resolved_directory:
            raise HTTPException(status_code=409, detail="project directory verification failed")
        relative = directory.relative_to(workspace).as_posix()
        (directories_preserved if existed else directories_created).append(relative)

    manifest_path = project / ".pib-project.json"
    expected_identity = {
        "projectId": project_id,
        "orgId": org_id,
        "workspaceId": workspace_id,
    }
    manifest_written = False
    manifest_preserved = False
    if manifest_path.exists():
        if manifest_path.is_symlink():
            raise HTTPException(status_code=400, detail="project manifest must not be a symlink")
        try:
            existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=409, detail=f"project manifest is invalid: {exc}")
        if not isinstance(existing_manifest, dict) or any(
            existing_manifest.get(key) != expected for key, expected in expected_identity.items()
        ):
            raise HTTPException(status_code=409, detail="project manifest identity conflict")
        manifest_preserved = True
    else:
        manifest = {
            **expected_identity,
            "relativePath": f"projects/{project_id}",
            "folderTemplate": "client-manager-standard",
            "folderVersion": 1,
            "sourceOfTruth": "vps",
            "syncStatus": "pending",
            "workspaceFolders": WORKSPACE_SUBDIRS,
        }
        try:
            with manifest_path.open("x", encoding="utf-8") as handle:
                json.dump(manifest, handle, indent=2, sort_keys=True)
                handle.write("\n")
            os.chmod(manifest_path, 0o660)
            manifest_written = True
        except FileExistsError:
            # A concurrent identical request may have won. Re-enter once so its
            # identity is validated instead of overwriting it.
            return _provision_project_folder(body, cowork_root=cowork_root)

    return {
        "projectId": project_id,
        "orgId": org_id,
        "workspaceId": workspace_id,
        "relativePath": f"projects/{project_id}",
        "folderStatus": "provisioned",
        # Creation on the VPS is not evidence of replica sync on other machines.
        "syncStatus": "pending",
        "folderTemplate": "client-manager-standard",
        "directoriesCreated": directories_created,
        "directoriesPreserved": directories_preserved,
        "manifestWritten": manifest_written,
        "manifestPreserved": manifest_preserved,
    }


@app.post("/profiles/{profile}/admin/project-folders")
async def provision_project_folder(profile: str, request: Request, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    body = await request.json()
    return _provision_project_folder(body)


@app.post("/profiles/{profile}/admin/client-workspaces")
async def provision_client_workspace(profile: str, request: Request, x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    _require_auth(profile, x_api_key, authorization)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be an object")

    client_name = _validate_client_name(str(body.get("clientName") or ""))
    domain = str(body.get("domain") or "").strip().lower()
    if not SAFE_NAME.match(domain):
        raise HTTPException(status_code=400, detail="invalid domain")
    org_id = str(body.get("orgId") or "").strip()
    if not org_id:
        raise HTTPException(status_code=400, detail="orgId is required")
    agent_name = str(body.get("agentName") or client_name.split()[0]).strip() or "Client"
    soul = body.get("soul") if isinstance(body.get("soul"), str) else None
    overwrite = body.get("overwriteExisting") is True or body.get("overwrite") is True

    requested_workspace = body.get("workspacePath") if isinstance(body.get("workspacePath"), str) else None
    requested_agent_root = body.get("agentDomainPath") if isinstance(body.get("agentDomainPath"), str) else None
    workspace = _safe_child_path(COWORK_ROOT, requested_workspace, "workspacePath") if requested_workspace else COWORK_ROOT / client_name
    agent_root_base = VAULT_ROOT / "agents"
    agent_root = _safe_child_path(agent_root_base, requested_agent_root, "agentDomainPath") if requested_agent_root else agent_root_base / domain

    workspace_folders, warnings = _safe_workspace_folders(body.get("workspaceFolders"))
    manifest = body.get("manifest") if isinstance(body.get("manifest"), dict) else None
    if manifest:
        if str(manifest.get("workspaceId") or "") != domain:
            raise HTTPException(status_code=400, detail="manifest.workspaceId must match domain")
        if str(manifest.get("orgId") or "") != org_id:
            raise HTTPException(status_code=400, detail="manifest.orgId must match orgId")
        manifest_vps_path = manifest.get("vpsPath")
        manifest_agent_path = manifest.get("agentDomainPath")
        if isinstance(manifest_vps_path, str) and manifest_vps_path:
            _safe_child_path(COWORK_ROOT, manifest_vps_path, "manifest.vpsPath")
        if isinstance(manifest_agent_path, str) and manifest_agent_path:
            _safe_child_path(agent_root_base, manifest_agent_path, "manifest.agentDomainPath")
    folder_registry = body.get("folderRegistry") if isinstance(body.get("folderRegistry"), list) else []
    workspace_instructions = body.get("workspaceInstructions") if isinstance(body.get("workspaceInstructions"), str) else None

    directories_created: list[str] = []
    for directory in [workspace, *(workspace / sub for sub in workspace_folders), agent_root / "wiki", agent_root / "logs", agent_root / "raw"]:
        existed = directory.exists()
        directory.mkdir(parents=True, exist_ok=True)
        if not existed:
            directories_created.append(str(directory))

    files_written: list[str] = []
    files_preserved: list[str] = []
    project_instructions = workspace_instructions or _render_client_claude(client_name, domain, agent_name, workspace, agent_root)
    file_specs = {
        agent_root / "index.md": _render_client_index(client_name, domain, org_id),
        agent_root / "wiki" / "hot.md": _render_client_hot(client_name, domain, org_id),
        workspace / "AGENTS.md": project_instructions,
        workspace / "CLAUDE.md": project_instructions,
    }
    for target, content in file_specs.items():
        if overwrite and target.exists():
            target.write_text(content, encoding="utf-8")
            os.chmod(target, 0o660)
            files_written.append(str(target))
        elif _write_if_missing(target, content):
            files_written.append(str(target))
        else:
            files_preserved.append(str(target))

    manifest_path = workspace / ".pib-workspace.json"
    manifest_written = False
    manifest_preserved = False
    if manifest:
        if overwrite or not manifest_path.exists():
            manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            os.chmod(manifest_path, 0o660)
            files_written.append(str(manifest_path))
            manifest_written = True
        else:
            files_preserved.append(str(manifest_path))
            manifest_preserved = True
    else:
        warnings.append("manifest missing; .pib-workspace.json not written")

    global_context = VAULT_ROOT / "global-context.md"
    mapping_updated = _upsert_line(global_context, f"| {client_name} | `agents/{domain}/` |", "## orgId")

    if body.get("configureLegacyProfile") is True:
        profile_result = _configure_profile_workspace(domain, workspace, soul)
    else:
        profile_result = {"configured": False, "reason": "legacy per-client Hermes profile configuration disabled for Workspace provisioning"}

    committed = False
    commit_error = None
    try:
        subprocess.run(["/usr/bin/git", "-C", str(VAULT_ROOT), "add", str(agent_root), str(global_context)], check=True, capture_output=True, text=True)
        result = subprocess.run(["/usr/bin/git", "-C", str(VAULT_ROOT), "commit", "-m", f"knowledge: provision {domain} workspace"], check=False, capture_output=True, text=True)
        committed = result.returncode == 0
        if result.returncode != 0 and "nothing to commit" not in (result.stdout + result.stderr).lower():
            commit_error = (result.stderr or result.stdout).strip()[:500]
    except Exception as exc:
        commit_error = str(exc)[:500]

    return {
        "clientName": client_name,
        "domain": domain,
        "orgId": org_id,
        "workspacePath": str(workspace),
        "agentDomainPath": str(agent_root),
        "workspaceFolders": workspace_folders,
        "directoriesCreated": directories_created,
        "filesWritten": files_written,
        "filesPreserved": files_preserved,
        "manifestWritten": manifest_written,
        "manifestPreserved": manifest_preserved,
        "folderRegistryAccepted": len(folder_registry),
        "mappingUpdated": mapping_updated,
        "profile": profile_result,
        "warnings": warnings,
        "committed": committed,
        "commitError": commit_error,
    }

@app.get("/health")
def health():
    return {"status": "ok"}
