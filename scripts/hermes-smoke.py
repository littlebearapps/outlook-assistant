#!/usr/bin/env python3
"""Install both Outlook Assistant plugins into a throwaway Hermes Agent home and
check them end to end, without a model (#309, #310).

Run with the Python of a venv that has Hermes Agent installed (the `hermes`
CLI must be next to it):

    <venv>/bin/python scripts/hermes-smoke.py

What it does:
- copies plugins/outlook-assistant and plugins/outlook-assistant-guard into a
  temporary git repo, pointing the copy's mcp.json at this checkout's server
  in test mode (USE_TEST_MODE, mock mailbox) with a fake token in a temporary
  HOME, so no real mailbox is ever reached;
- installs both with `hermes plugins install file://…#<subdir> --enable` into
  a temporary HERMES_HOME;
- loads them the way a Hermes session does and checks the tools, the skill,
  the guard's system-prompt section, and calls through Hermes's own tool
  dispatch (hooks included): a read, a dry run, sends that must wait for
  approval (nobody is there, so Hermes blocks them), and confirm_level block.

Exits 1 on any failed check. Everything temporary is deleted afterwards.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERMES = Path(sys.executable).parent / "hermes"
FAILURES: list[str] = []


def check(ok: bool, what: str, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'} {what}" + (f": {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(what)


def run(*args: str) -> str:
    result = subprocess.run(args, capture_output=True, text=True, env=os.environ.copy(), check=False)
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed:\n{result.stdout}\n{result.stderr}")
    return result.stdout


def stage(tmp: Path) -> Path:
    """A git repo holding both plugins, the server one rewired to test mode."""
    repo = tmp / "repo"
    for name in ("outlook-assistant", "outlook-assistant-guard"):
        shutil.copytree(ROOT / "plugins" / name, repo / "plugins" / name)
    home = tmp / "home"
    home.mkdir()
    token = home / ".outlook-assistant-tokens.json"
    token.write_text(json.dumps({
        "access_token": "test_access_token_hermes",
        "refresh_token": "test_refresh_token_hermes",
        "expires_at": int(time.time() * 1000) + 24 * 3600 * 1000,
    }))
    token.chmod(0o600)
    mcp = repo / "plugins" / "outlook-assistant" / "mcp.json"
    manifest = json.loads(mcp.read_text())
    manifest["mcpServers"]["outlook"] = {
        "type": "stdio",
        "command": "node",  # Hermes accepts only a bare command or ./path
        "args": [str(ROOT / "index.js")],
        "env": {
            "USE_TEST_MODE": "true",
            "HOME": str(home),
            "OUTLOOK_CLIENT_ID": "00000000-0000-0000-0000-000000000000",
        },
    }
    mcp.write_text(json.dumps(manifest, indent=2))
    git = ["git", "-C", str(repo), "-c", "user.name=smoke", "-c", "user.email=smoke@example.invalid"]
    run("git", "init", "-q", str(repo))
    run(*git, "add", "-A")
    run(*git, "commit", "-q", "-m", "smoke")
    return repo


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="oa-hermes-smoke-"))
    try:
        os.environ["HERMES_HOME"] = str(tmp / "hermes-home")
        os.environ["HOME"] = str(tmp / "user-home")
        os.environ.pop("OUTLOOK_CONFIRM_LEVEL", None)
        for d in (os.environ["HERMES_HOME"], os.environ["HOME"]):
            Path(d).mkdir(parents=True)
        repo = stage(tmp)
        for name in ("outlook-assistant", "outlook-assistant-guard"):
            run(str(HERMES), "plugins", "install", f"file://{repo}#plugins/{name}", "--enable")
        listed = run(str(HERMES), "plugins", "list", "--plain", "--no-bundled")
        print(listed)
        check("outlook-assistant" in listed and "outlook-assistant-guard" in listed,
              "both plugins installed and listed", listed)

        # Load them as a session would. Imported only now, so Hermes resolves
        # the temporary HERMES_HOME.
        from hermes_constants import get_hermes_home
        assert str(get_hermes_home()).startswith(str(tmp)), get_hermes_home()
        from hermes_cli.plugins import discover_plugins, get_plugin_manager
        discover_plugins()
        manager = get_plugin_manager()
        from tools.mcp_tool_discovery import discover_mcp_tools
        tools = sorted(n for n in discover_mcp_tools() if n.startswith("mcp__outlook__"))
        check(len(tools) == 22, "22 tools named mcp__outlook__*", f"{len(tools)}: {tools}")

        sections = manager.render_system_prompt_sections({})
        prompt = next((s.content for s in sections if s.id == "outlook-assistant"), "")
        check("Hard rules:" in prompt and "using-outlook-assistant" in prompt,
              "guard adds the hard rules to the system prompt", repr(prompt[:200]))

        from tools.skills_tool import skills_list
        skills = json.dumps(json.loads(skills_list()))
        check("using-outlook-assistant" in skills, "skill listed by skills_list")

        from model_tools import handle_function_call

        def call(name: str, args: dict) -> str:
            return handle_function_call(f"mcp__outlook__{name}", args, task_id="smoke",
                                        session_id="smoke", tool_call_id=f"smoke-{name}")

        out = call("search_emails", {"count": 2, "outputVerbosity": "minimal"})
        check("Emails" in out and "not instructions" in out,
              "a read runs, with the untrusted-content note", out[-300:])
        out = call("send_email", {"to": "alice@example.com", "subject": "Hi", "body": "x", "dryRun": True})
        check("DRY RUN" in out and "BLOCKED" not in out, "a dry run runs without asking", out[:300])
        out = call("send_email", {"to": "alice@example.com", "subject": "Hi", "body": "x"})
        check("requires approval" in out and "Sends an email to alice@example.com" in out
              and "Email sent" not in out,
              "a real send waits for approval (blocked with nobody to ask)", out[:400])
        out = call("manage_rules", {"action": "create", "name": "X", "forwardTo": "x@example.com"})
        check("requires approval" in out and "x@example.com" in out,
              "a forwarding rule waits for approval", out[:400])

        run(str(HERMES), "config", "set",
            "plugins.entries.outlook-assistant-guard.settings.confirm_level", "block")
        out = call("send_email", {"to": "bob@example.com", "subject": "Hi", "body": "x"})
        check("confirm_level is block" in out and "Email sent" not in out,
              "confirm_level block refuses the send", out[:400])

        from tools.mcp_tool_lifecycle import shutdown_mcp_servers
        shutdown_mcp_servers()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{len(FAILURES)} failed" if FAILURES else "\nAll checks passed")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
