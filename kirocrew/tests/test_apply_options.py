"""Unit tests for apply_options.py. Run: python3 -m unittest discover kirocrew/tests"""

import importlib.util
import io
import json
import shlex
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

# Placeholder only, never a real key.
FAKE_KEY = "ksk_FAKE_PLACEHOLDER_not_a_real_key"

_SPEC = importlib.util.spec_from_file_location(
    "apply_options", Path(__file__).resolve().parents[1] / "apply_options.py"
)
apply_options = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(apply_options)


class ApplyTest(unittest.TestCase):
    def test_defaults_are_low_memory(self):
        cfg = apply_options.apply({}, {})
        self.assertEqual(cfg["session"]["pool_size"], 0)
        self.assertEqual(cfg["memory"]["embedding_weight_repack"], False)
        self.assertEqual(cfg["agent"]["sandbox"], "auto")
        self.assertIs(cfg["agent"]["sandbox_allow_unsandboxed_exec"], True)
        self.assertNotIn("url", cfg["dashboard"])

    def test_removes_stale_keys_and_keeps_user_settings(self):
        cfg = {
            "agent": {"sandbox": "off", "approval_mode": "yolo"},
            "session": {"warm_pool_size": 0, "pool_size": 1},
            "knowledge": {"embed_content_budget": 0, "other": 1},
            "dashboard": {"open_browser": False, "bot_name": "Bot"},
        }
        cfg = apply_options.apply(cfg, {"log_level": "debug"})
        self.assertNotIn("warm_pool_size", cfg["session"])
        self.assertEqual(cfg["knowledge"], {"other": 1})
        self.assertNotIn("open_browser", cfg["dashboard"])
        self.assertEqual(cfg["dashboard"]["bot_name"], "Bot")
        self.assertEqual(cfg["agent"]["approval_mode"], "yolo")
        self.assertEqual(cfg["agent"]["sandbox"], "auto")
        self.assertEqual(cfg["agent"]["log_level"], "DEBUG")
        self.assertEqual(cfg["session"]["pool_size"], 0)

    def test_operator_sandbox_choice_wins(self):
        cfg = {"agent": {"sandbox": "strict", "sandbox_allow_unsandboxed_exec": False}}
        cfg = apply_options.apply(cfg, {})
        self.assertEqual(cfg["agent"]["sandbox"], "strict")
        self.assertIs(cfg["agent"]["sandbox_allow_unsandboxed_exec"], False)

    def test_external_url_option_beats_ha_url(self):
        cfg = apply_options.apply({}, {"external_url": "https://a.example"}, "https://b.example")
        self.assertEqual(cfg["dashboard"]["url"], "https://a.example")
        cfg = apply_options.apply({}, {}, "https://b.example")
        self.assertEqual(cfg["dashboard"]["url"], "https://b.example")

    def test_channels_use_real_keys(self):
        opts = {
            "telegram_bot_token": "t",
            "telegram_allowed_user_ids": [1, 2],
            "discord_bot_token": "d",
            "discord_allowed_user_ids": ["123"],
        }
        cfg = apply_options.apply({}, opts)
        self.assertEqual(cfg["telegram"], {"enabled": True, "allowed_user_ids": [1, 2]})
        self.assertEqual(cfg["discord"], {"enabled": True, "allowed_user_ids": ["123"]})
        self.assertNotIn("bot_token", cfg["telegram"])

    def test_secret_exports_are_shell_safe(self):
        lines = apply_options.secret_exports({"kiro_api_key": "a'b; rm -rf x", "slack_owner_id": ""})
        self.assertEqual(len(lines), 2)
        self.assertEqual(shlex.split(lines[0]), ["export", "KIRO_API_KEY=a'b; rm -rf x"])

    def test_signin_marker_names_the_method_only(self):
        lines = apply_options.secret_exports({"kiro_api_key": FAKE_KEY})
        self.assertIn("ADDON_SIGNIN=api-key", lines)
        self.assertEqual(sum(FAKE_KEY in line for line in lines), 1)
        self.assertNotIn(FAKE_KEY, lines[-1])
        self.assertEqual(apply_options.secret_exports({})[-1], "ADDON_SIGNIN=none")
        self.assertEqual(apply_options.secret_exports({"kiro_api_key": ""})[-1], "ADDON_SIGNIN=none")


class MainTest(unittest.TestCase):
    def test_key_only_reaches_the_export_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            opts_path = Path(tmp) / "options.json"
            opts_path.write_text(json.dumps({"kiro_api_key": FAKE_KEY}))
            cfg_path = Path(tmp) / "crew" / "config.json"
            out, err = io.StringIO(), io.StringIO()
            with mock.patch.object(apply_options, "OPTIONS_PATH", opts_path), \
                    mock.patch.object(apply_options, "CONFIG_PATH", cfg_path), \
                    mock.patch.dict(apply_options.os.environ, {"SUPERVISOR_TOKEN": ""}), \
                    redirect_stdout(out), redirect_stderr(err):
                self.assertEqual(apply_options.main(), 0)
            self.assertNotIn(FAKE_KEY, cfg_path.read_text())
            self.assertEqual(err.getvalue(), "")
            key_lines = [line for line in out.getvalue().splitlines() if FAKE_KEY in line]
            self.assertEqual(key_lines, [f"export KIRO_API_KEY={FAKE_KEY}"])
            self.assertIn("ADDON_SIGNIN=api-key", out.getvalue().splitlines())


if __name__ == "__main__":
    unittest.main()
