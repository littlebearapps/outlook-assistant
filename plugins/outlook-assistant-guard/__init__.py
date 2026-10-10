"""outlook-assistant-guard: the Outlook Assistant safety layer for Hermes Agent.

Hermes loads the Outlook Assistant MCP server and skill from the portable
``outlook-assistant`` plugin, but it reads neither that plugin's hook files nor
the server's ``instructions``, and a native plugin can't start an MCP server.
This companion plugin adds what is missing:

- ``pre_tool_call``: asks the user, through Hermes's approval gate, before any
  Outlook call that reaches other people, deletes something or keeps acting
  (rules, forwarding, automatic replies), with a plain-English reason;
- ``transform_tool_result``: after tools that return other people's content,
  a note that it is data, not instructions;
- a system-prompt section with the server's hard rules and a pointer to the
  ``using-outlook-assistant`` skill (Hermes lists plugin skills only on
  request).

``register`` fails closed: if a bundled file is missing it raises, so Hermes
shows the plugin as failed instead of loading it without its checks.
"""

from __future__ import annotations

from . import gate

SYSTEM_PROMPT = gate.HERE / "system-prompt.md"


def register(ctx) -> None:
    missing = [p.name for p in (gate.GATE, gate.RISK_MAP, SYSTEM_PROMPT) if not p.is_file()]
    if missing:
        raise RuntimeError(
            "outlook-assistant-guard is missing "
            + ", ".join(missing)
            + "; reinstall it with `hermes plugins install outlook-assistant-guard --enable`."
        )
    gate.configure(get_config=getattr(ctx, "get_config", None))
    ctx.register_hook("pre_tool_call", gate.pre_tool_call)
    ctx.register_hook("transform_tool_result", gate.transform_tool_result)
    ctx.register_system_prompt_section(
        "outlook-assistant", SYSTEM_PROMPT.read_text(encoding="utf-8")
    )
