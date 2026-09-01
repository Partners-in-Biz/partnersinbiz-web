#!/usr/bin/env python3
"""Idempotently ensure the Hermes gateway per-run model allowlist keeps the
DeepSeek models PiB dispatches (incl. the dated Nous-portal variant
deepseek-v4-flash-0731 used as pip's primary model for Auto company/workspace
chats), and re-applies the PiB working-directory auto-create patch.

WHY (allowlist): `hermes update` rewrites `gateway/platforms/api_server.py`
from upstream, which drops DeepSeek from `_DEFAULT_RUN_MODEL_ALLOWLIST`. PiB
then sends `model: deepseek/deepseek-v4-flash-0731` as a per-run override, the
gateway returns HTTP 400 "Requested model is not allowlisted for per-run
override", and company chats surface "The agent gateway rejected the run
request" (dispatch_rejected).

WHY (working-directory): Bot-mode chat isolation folders (bots/{agentId}) may
not exist on the VPS when a conversation is dispatched from the web (which runs
on Vercel and cannot mkdir on the runtime). The gateway is the authenticated
runtime that performs the existence check, so a PiB fork commit auto-creates a
missing working_directory when a valid working_directory_root bounds it. An
upstream rewrite drops that block too; this script re-applies it idempotently.

This script is safe to run repeatedly (idempotent) and after every `hermes
update`.

Usage:
  python3 ensure_gateway_allowlist.py            # apply (insert if missing)
  python3 ensure_gateway_allowlist.py --check     # verify only; exit 1 if missing
  python3 ensure_gateway_allowlist.py --restart   # restart active hermes@*.service gateways after a repair
  python3 ensure_gateway_allowlist.py --path <api_server.py>   # override path
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_PATH = Path("/var/lib/hermes/hermes-agent/gateway/platforms/api_server.py")

# Models PiB dispatches as per-run overrides. The gateway matches the raw model
# string exactly, so both bare and provider-prefixed forms must be present.
REQUIRED_DEEPSEEK = [
    "deepseek-v4-flash",
    "deepseek-v4-flash-0731",
    "deepseek-v4-pro",
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4-flash-0731",
    "deepseek/deepseek-v4-pro",
    "deepseek/deepseek-chat",
    "deepseek/deepseek-reasoner",
]

ALLOWLIST_RE = re.compile(
    r"(_DEFAULT_RUN_MODEL_ALLOWLIST\s*=\s*\{)(.*?)(\})",
    re.DOTALL,
)


def load(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def find_allowlist(text: str):
    match = ALLOWLIST_RE.search(text)
    if not match:
        raise RuntimeError(
            "Could not locate _DEFAULT_RUN_MODEL_ALLOWLIST block; "
            "api_server.py may have changed shape."
        )
    return match


def missing_models(text: str) -> list[str]:
    match = find_allowlist(text)
    body = match.group(2)
    present = set(re.findall(r'^\s*"([^"]+)"', body, re.MULTILINE))
    return [m for m in REQUIRED_DEEPSEEK if m not in present]


def apply(text: str) -> tuple[str, list[str]]:
    missing = missing_models(text)
    if not missing:
        return text, []
    match = find_allowlist(text)
    insertion = "\n    # DeepSeek (PiB per-run override; re-applied idempotently)\n" + "".join(
        f'    "{m}",\n' for m in REQUIRED_DEEPSEEK
    )
    # Insert before the closing brace of the allowlist block.
    head = text[: match.end(2)]
    tail = text[match.end(2):]
    return head + insertion + tail, missing


# ---------------------------------------------------------------------------
# Working-directory auto-create patch (PiB fork commit, re-applied idempotently)
# ---------------------------------------------------------------------------

WD_START_MARKER = '        working_directory = ""'
WD_END_MARKER = "            working_directory = str(canonical_working_directory)"
WD_PIB_MARKER = "# PiB: validate a working_directory_root first"

WD_NEW_BLOCK = '''        working_directory = ""
        if "working_directory" in body:
            raw_working_directory = body["working_directory"]
            if not isinstance(raw_working_directory, str) or not raw_working_directory.strip():
                return web.json_response(
                    _openai_error("working_directory must be a non-empty absolute path to an existing directory"),
                    status=400,
                )
            working_directory_path = Path(raw_working_directory.strip()).expanduser()
            try:
                working_directory_absolute = working_directory_path.is_absolute()
            except OSError:
                working_directory_absolute = False
            if not working_directory_absolute:
                return web.json_response(
                    _openai_error("working_directory must be a non-empty absolute path to an existing directory"),
                    status=400,
                )
            # PiB: validate a working_directory_root first, then auto-create a
            # missing working_directory inside that root so Bot-mode chat
            # isolation folders (bots/{agentId}) exist before the run is accepted.
            # Without a root, the path must already exist.
            canonical_working_directory_root = None
            if "working_directory_root" in body:
                raw_working_directory_root = body["working_directory_root"]
                if not isinstance(raw_working_directory_root, str) or not raw_working_directory_root.strip():
                    return web.json_response(
                        _openai_error("working_directory_root must contain the working directory"),
                        status=400,
                    )
                working_directory_root = Path(raw_working_directory_root.strip()).expanduser()
                try:
                    working_directory_root_ok = working_directory_root.is_absolute() and working_directory_root.is_dir()
                except OSError:
                    working_directory_root_ok = False
                if not working_directory_root_ok:
                    return web.json_response(
                        _openai_error("working_directory_root must contain the working directory"),
                        status=400,
                    )
                try:
                    canonical_working_directory_root = working_directory_root.resolve()
                except OSError:
                    return web.json_response(
                        _openai_error("working_directory_root must contain the working directory"),
                        status=400,
                    )
            try:
                canonical_working_directory = working_directory_path.resolve(strict=True)
            except FileNotFoundError:
                if canonical_working_directory_root is not None:
                    try:
                        lexical_working_directory = working_directory_path.resolve(strict=False)
                    except OSError:
                        return web.json_response(
                            _openai_error("working_directory must be a non-empty absolute path to an existing directory"),
                            status=400,
                        )
                    if not lexical_working_directory.is_relative_to(canonical_working_directory_root):
                        return web.json_response(
                            _openai_error("working_directory must stay inside working_directory_root"),
                            status=400,
                        )
                    try:
                        lexical_working_directory.mkdir(parents=True, exist_ok=True)
                    except OSError:
                        return web.json_response(
                            _openai_error("working_directory could not be created inside working_directory_root"),
                            status=400,
                        )
                    try:
                        canonical_working_directory = lexical_working_directory.resolve(strict=True)
                    except OSError:
                        return web.json_response(
                            _openai_error("working_directory must be a non-empty absolute path to an existing directory"),
                            status=400,
                        )
                else:
                    return web.json_response(
                        _openai_error("working_directory must be a non-empty absolute path to an existing directory"),
                        status=400,
                    )
            except OSError:
                return web.json_response(
                    _openai_error("working_directory must be a non-empty absolute path to an existing directory"),
                    status=400,
                )
            if canonical_working_directory_root is not None and not canonical_working_directory.is_relative_to(canonical_working_directory_root):
                return web.json_response(
                    _openai_error("working_directory must stay inside working_directory_root"),
                    status=400,
                )
            working_directory = str(canonical_working_directory)
'''


def wd_patch_present(text: str) -> bool:
    return WD_PIB_MARKER in text


def apply_wd_patch(text: str) -> tuple[str, bool]:
    """Rewrite the working_directory block to the auto-create version.

    Returns (new_text, applied). Raises RuntimeError if markers are missing.
    """
    if wd_patch_present(text):
        return text, False
    start = text.find(WD_START_MARKER)
    if start == -1:
        raise RuntimeError("Could not locate working_directory start marker")
    end = text.find(WD_END_MARKER, start)
    if end == -1:
        raise RuntimeError("Could not locate working_directory end marker")
    block_end = end + len(WD_END_MARKER)
    return text[:start] + WD_NEW_BLOCK + text[block_end:], True


def running_profile_gateways() -> list[str]:
    """Return profile names of currently-running manual gateways.

    The VPS runs each profile's gateway as a manual process
    (`python -m hermes_cli.main --profile <name> gateway run --replace` with
    PPID 1), not under systemd. Detect them from the process table.
    """
    try:
        ps = subprocess.run(
            ["ps", "-eo", "ppid,cmd"],
            capture_output=True, text=True, timeout=30,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return []
    profiles: list[str] = []
    for line in ps.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        ppid, cmd = parts
        if ppid != "1":
            continue  # only the daemonised gateways (PPID 1)
        match = re.search(r"(?:--profile|-p)\s+(\S+)\s+gateway\s+run", cmd)
        is_gateway_proc = "hermes_cli.main" in cmd or "/hermes" in cmd or cmd.strip().startswith("/usr/local/bin/hermes")
        if match and is_gateway_proc:
            profile = match.group(1)
            if profile not in profiles:
                profiles.append(profile)
    return profiles


def restart_active_gateways() -> list[str]:
    """Restart running profile gateways by daemonising `gateway run --replace`.

    The VPS supervises each profile gateway as a manual PPID-1 daemon
    (not systemd, and linger is not enabled so `hermes gateway restart` is
    refused). The canonical replace primitive is
    `hermes -p <profile> gateway run --replace`, which swaps the running
    instance. Returns the list of profiles restarted; a stopped profile is
    never started.
    """
    restarted = []
    for profile in running_profile_gateways():
        try:
            # setsid + nohup detaches so the new gateway survives this script's exit.
            res = subprocess.run(
                [
                    "sudo", "-u", "hermes", "bash", "-c",
                    f"export HERMES_HOME=/var/lib/hermes; "
                    f"setsid nohup hermes -p {profile} gateway run --replace "
                    f">>/var/log/hermes-gateway-{profile}.log 2>&1 < /dev/null &",
                ],
                capture_output=True, text=True, timeout=30,
            )
        except (subprocess.SubprocessError, OSError) as exc:
            print(f"ensure_gateway_allowlist: restart {profile} failed: {exc}", file=sys.stderr)
            continue
        if res.returncode == 0:
            restarted.append(profile)
        else:
            print(
                f"ensure_gateway_allowlist: restart {profile} failed: "
                f"{(res.stderr or res.stdout).strip()[:300]}",
                file=sys.stderr,
            )
    return restarted


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify only; do not write, exit 1 if required models missing",
    )
    parser.add_argument(
        "--restart",
        action="store_true",
        help="restart active hermes@*.service gateways after a repair (so the "
             "running gateway loads the fixed allowlist). Ignored in --check mode.",
    )
    parser.add_argument(
        "--path",
        default=str(DEFAULT_PATH),
        help=f"path to api_server.py (default: {DEFAULT_PATH})",
    )
    args = parser.parse_args(argv)

    path = Path(args.path)
    if not path.exists():
        print(f"ensure_gateway_allowlist: {path} not found", file=sys.stderr)
        return 2

    text = load(path)
    changed = False

    # --- Allowlist repair ---
    missing = missing_models(text)
    if missing:
        print(
            f"ensure_gateway_allowlist: MISSING {len(missing)} required models: "
            + ", ".join(missing)
        )
        if args.check:
            print("ensure_gateway_allowlist: --check FAILED (required models absent)", file=sys.stderr)
            return 1
        text, inserted = apply(text)
        changed = True
    else:
        print("ensure_gateway_allowlist: OK — all required DeepSeek models allowlisted")

    # --- Working-directory auto-create patch repair ---
    try:
        wd_patched = wd_patch_present(text)
        if not wd_patched:
            if args.check:
                print("ensure_gateway_allowlist: --check FAILED (working-directory patch absent)", file=sys.stderr)
                return 1
            text, applied = apply_wd_patch(text)
            changed = changed or applied
            if applied:
                print("ensure_gateway_allowlist: re-applied working-directory auto-create patch")
            else:
                print("ensure_gateway_allowlist: working-directory patch marker present; no-op")
        else:
            print("ensure_gateway_allowlist: working-directory auto-create patch present; no-op")
    except RuntimeError as exc:
        print(f"ensure_gateway_allowlist: {exc}", file=sys.stderr)
        if args.check:
            return 1

    if changed:
        backup = path.with_suffix(".py.bak-ensure-allowlist")
        if not backup.exists():
            backup.write_text(load(path), encoding="utf-8")
        path.write_text(text, encoding="utf-8")
        print(f"ensure_gateway_allowlist: wrote {path}")

    if args.restart and changed:
        restarted = restart_active_gateways()
        if restarted:
            print(
                "ensure_gateway_allowlist: restarted gateways: "
                + ", ".join(restarted)
            )
        else:
            print(
                "ensure_gateway_allowlist: no active hermes@*.service units to restart; "
                "the running gateway may not load the fix until its next restart.",
                file=sys.stderr,
            )
    elif args.restart and not changed:
        print("ensure_gateway_allowlist: no changes; not restarting gateways")
    elif changed:
        print(
            "ensure_gateway_allowlist: NOTE — restart the gateway for changes to take "
            "effect (e.g. systemctl restart 'hermes@*.service' or --restart)."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
