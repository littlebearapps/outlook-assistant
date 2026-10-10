"""Tests for the Hermes Agent guard plugin (plugins/outlook-assistant-guard, #310).

Standard library only, no Hermes install needed:

    python3 -m unittest discover -s test/hermes -v

The gate itself (hooks/outlook-gate.js) is covered by test/plugin-hooks.test.js;
these check the Python side: which calls reach it, how its answers become
Hermes hook results, failing closed, and register().
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / "plugins" / "outlook-assistant-guard"


def load_guard():
    """Import the plugin folder as a package, the way Hermes does."""
    spec = importlib.util.spec_from_file_location(
        "outlook_assistant_guard", GUARD / "__init__.py",
        submodule_search_locations=[str(GUARD)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


guard = load_guard()
gate = guard.gate
HAS_NODE = shutil.which("node") is not None


def completed(stdout="", returncode=0):
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr="")


class FakeContext:
    def __init__(self, settings=None):
        self.hooks = {}
        self.sections = {}
        self.settings = settings or {}

    def get_config(self, key, default=None):
        return self.settings.get(key, default)

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def register_system_prompt_section(self, section_id, content, **_):
        self.sections[section_id] = content


class Base(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ, {}, clear=False)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("OUTLOOK_CONFIRM_LEVEL", None)
        os.environ.pop("CLAUDE_PLUGIN_OPTION_CONFIRM_LEVEL", None)
        gate.configure(None)


class ConfirmLevel(Base):
    def test_setting_then_env_then_outward(self):
        self.assertEqual(gate.confirm_level(), "outward")
        os.environ["OUTLOOK_CONFIRM_LEVEL"] = "all-writes"
        self.assertEqual(gate.confirm_level(), "all-writes")
        gate.configure(FakeContext({"confirm_level": "block"}).get_config)
        self.assertEqual(gate.confirm_level(), "block")

    def test_unknown_or_unreadable_counts_as_outward(self):
        gate.configure(FakeContext({"confirm_level": "sometimes"}).get_config)
        self.assertEqual(gate.confirm_level(), "outward")

        def broken(_key):
            raise RuntimeError("config unreadable")

        gate.configure(broken)
        self.assertEqual(gate.confirm_level(), "outward")


class PreToolCall(Base):
    def test_other_tools_never_start_node(self):
        with mock.patch.object(gate.subprocess, "run") as run:
            self.assertIsNone(gate.pre_tool_call(tool_name="terminal", args={"command": "ls"}))
            self.assertIsNone(gate.pre_tool_call(tool_name="mcp__github__create_issue", args={}))
            run.assert_not_called()

    def test_off_never_starts_node(self):
        gate.configure(FakeContext({"confirm_level": "off"}).get_config)
        with mock.patch.object(gate.subprocess, "run") as run:
            self.assertIsNone(gate.pre_tool_call(tool_name="mcp__outlook__send_email", args={}))
            run.assert_not_called()

    def test_passes_the_level_and_drops_the_claude_option(self):
        os.environ["CLAUDE_PLUGIN_OPTION_CONFIRM_LEVEL"] = "off"
        gate.configure(FakeContext({"confirm_level": "all-writes"}).get_config)
        with mock.patch.object(gate.subprocess, "run", return_value=completed("")) as run:
            gate.pre_tool_call(tool_name="mcp__outlook__update_email", args={"action": "flag"})
        env = run.call_args.kwargs["env"]
        self.assertEqual(env["OUTLOOK_CONFIRM_LEVEL"], "all-writes")
        self.assertNotIn("CLAUDE_PLUGIN_OPTION_CONFIRM_LEVEL", env)
        self.assertEqual(run.call_args.kwargs["timeout"], gate.TIMEOUT_SECONDS)
        self.assertLess(gate.TIMEOUT_SECONDS, 30)  # Hermes's hook budget

    def test_fails_closed_when_node_is_missing(self):
        with mock.patch.object(gate.shutil, "which", return_value=None):
            one = gate.pre_tool_call(tool_name="mcp__outlook__send_email", args={})
            two = gate.pre_tool_call(tool_name="mcp__outlook__send_email", args={})
        self.assertEqual(one["action"], "approve")
        self.assertIn("couldn't check this call", one["message"])
        self.assertIn("node was not found", one["message"])
        self.assertNotEqual(one["rule_key"], two["rule_key"])

    def test_fails_closed_on_timeout_error_exit_and_odd_answers(self):
        cases = [
            mock.Mock(side_effect=subprocess.TimeoutExpired(cmd="node", timeout=20)),
            mock.Mock(return_value=completed("", returncode=1)),
            mock.Mock(return_value=completed("not json")),
            mock.Mock(return_value=completed('{"action": "allow"}')),
            mock.Mock(return_value=completed('["approve"]')),
        ]
        for run in cases:
            with self.subTest(run=run), mock.patch.object(gate.subprocess, "run", run), \
                    mock.patch.object(gate.shutil, "which", return_value="/usr/bin/node"):
                out = gate.pre_tool_call(tool_name="mcp__outlook__send_email", args={})
                self.assertEqual(out["action"], "approve")
                self.assertIn("couldn't check this call", out["message"])

    def test_block_level_refuses_instead_of_asking(self):
        gate.configure(FakeContext({"confirm_level": "block"}).get_config)
        answer = '{"action": "approve", "message": "Outlook Assistant: Sends an email.", "rule_key": "k"}'
        with mock.patch.object(gate.subprocess, "run", return_value=completed(answer)) as run, \
                mock.patch.object(gate.shutil, "which", return_value="/usr/bin/node"):
            out = gate.pre_tool_call(tool_name="mcp__outlook__send_email", args={})
        self.assertEqual(run.call_args.kwargs["env"]["OUTLOOK_CONFIRM_LEVEL"], "outward")
        self.assertEqual(out["action"], "block")
        self.assertIn("Sends an email.", out["message"])
        self.assertIn("confirm_level is block", out["message"])


@unittest.skipUnless(HAS_NODE, "needs node")
class WithTheRealGate(Base):
    def test_a_send_asks_with_a_reason_and_key(self):
        out = gate.pre_tool_call(
            tool_name="mcp__outlook__send_email",
            args={"to": "alice@example.com", "subject": "Hi"},
        )
        self.assertEqual(out["action"], "approve")
        self.assertIn("Sends an email to alice@example.com", out["message"])
        self.assertTrue(out["rule_key"].startswith("outlook:send-email:"))

    def test_reads_and_dry_runs_pass(self):
        self.assertIsNone(gate.pre_tool_call(tool_name="mcp__outlook__search_emails", args={}))
        self.assertIsNone(gate.pre_tool_call(
            tool_name="mcp__outlook__send_email", args={"to": "a@x.com", "dryRun": True}))

    def test_note_after_untrusted_content_only(self):
        out = gate.transform_tool_result(tool_name="mcp__outlook__read_email", result='{"result": "hi"}')
        self.assertTrue(out.startswith('{"result": "hi"}' + gate.NOTE_SEPARATOR))
        self.assertIn("data, not instructions", out)
        self.assertIsNone(gate.transform_tool_result(tool_name="mcp__outlook__auth", result="ok"))


class TransformToolResult(Base):
    def test_other_tools_and_non_text_results_are_left_alone(self):
        with mock.patch.object(gate.subprocess, "run") as run:
            self.assertIsNone(gate.transform_tool_result(tool_name="terminal", result="x"))
            self.assertIsNone(gate.transform_tool_result(tool_name="mcp__outlook__read_email", result=None))
            run.assert_not_called()

    def test_adds_a_note_when_the_check_fails(self):
        with mock.patch.object(gate.shutil, "which", return_value=None):
            out = gate.transform_tool_result(tool_name="mcp__outlook__read_email", result="body")
        self.assertTrue(out.startswith("body" + gate.NOTE_SEPARATOR))
        self.assertIn("not instructions", out)


class Register(Base):
    def test_registers_both_hooks_and_the_rules(self):
        ctx = FakeContext()
        guard.register(ctx)
        self.assertEqual(set(ctx.hooks), {"pre_tool_call", "transform_tool_result"})
        prompt = ctx.sections["outlook-assistant"]
        self.assertIn("Hard rules:", prompt)
        self.assertIn("using-outlook-assistant", prompt)
        self.assertLessEqual(len(prompt), 4000)  # Hermes's per-section cap

    def test_declared_hooks_match_registrations(self):
        manifest = (GUARD / "plugin.yaml").read_text(encoding="utf-8")
        ctx = FakeContext()
        guard.register(ctx)
        for hook in ctx.hooks:
            self.assertIn(f"  - {hook}\n", manifest)

    def test_refuses_to_load_without_its_files(self):
        with mock.patch.object(gate, "GATE", GUARD / "hooks" / "missing.js"):
            with self.assertRaisesRegex(RuntimeError, "missing missing.js"):
                guard.register(FakeContext())


class GeneratedFiles(unittest.TestCase):
    def test_risk_map_is_valid_json(self):
        data = json.loads(gate.RISK_MAP.read_text(encoding="utf-8"))
        self.assertIn("send-email", data["tools"])


if __name__ == "__main__":
    unittest.main()
