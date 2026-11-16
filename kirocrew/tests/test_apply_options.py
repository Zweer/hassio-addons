"""Unit tests for apply_options.py. Run: python3 -m unittest discover kirocrew/tests"""

import importlib.util
import shlex
import unittest
from pathlib import Path

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
        self.assertEqual(len(lines), 1)
        self.assertEqual(shlex.split(lines[0]), ["export", "KIRO_API_KEY=a'b; rm -rf x"])


if __name__ == "__main__":
    unittest.main()
