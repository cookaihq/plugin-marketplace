import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import threading
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "tikin-setup" / "scripts" / "tikin-config"


class TikinConfigTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.xdg_home = Path(self.tempdir.name) / "config"
        self.env = os.environ.copy()
        self.env["XDG_CONFIG_HOME"] = str(self.xdg_home)
        self.env.pop("TIKIN_API_KEY", None)
        self.env.pop("TIKIN_BASE_URL", None)

    def run_config(self, *args, input_text=None, env=None, check=True):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            input=input_text,
            text=True,
            capture_output=True,
            cwd=self.tempdir.name,
            env=env or self.env,
            check=False,
        )
        if check and result.returncode != 0:
            self.fail(
                f"command failed ({result.returncode}): {result.stderr or result.stdout}"
            )
        return result

    def test_init_creates_default_settings_with_private_permissions(self):
        self.run_config("init")

        settings_path = self.xdg_home / "tikin" / "settings.json"
        self.assertEqual(
            json.loads(settings_path.read_text()),
            {"routing": {"default": "auto", "platforms": {}}},
        )
        self.assertEqual(stat.S_IMODE(settings_path.stat().st_mode), 0o600)

    def test_empty_xdg_config_home_uses_home_default(self):
        process_env = self.env.copy()
        home = Path(self.tempdir.name) / "home"
        process_env["HOME"] = str(home)
        process_env["XDG_CONFIG_HOME"] = ""

        self.run_config("init", env=process_env)

        self.assertTrue((home / ".config" / "tikin" / "settings.json").is_file())
        self.assertFalse((Path(self.tempdir.name) / "tikin").exists())

    def test_init_migrates_legacy_env_without_echoing_the_key(self):
        config_dir = self.xdg_home / "tikin"
        config_dir.mkdir(parents=True)
        legacy_path = config_dir / "env"
        secret = "secret-from-legacy"
        legacy_path.write_text(f"TIKIN_API_KEY={secret}\n")
        legacy_path.chmod(0o644)

        result = self.run_config("init")

        env_path = config_dir / ".env"
        self.assertFalse(legacy_path.exists())
        self.assertEqual(env_path.read_text(), f"TIKIN_API_KEY={secret}\n")
        self.assertEqual(stat.S_IMODE(env_path.stat().st_mode), 0o600)
        self.assertNotIn(secret, result.stdout)
        self.assertNotIn(secret, result.stderr)

    def test_set_key_writes_private_env_and_status_never_echoes_secrets(self):
        secret = "secret-from-stdin"
        self.run_config("init")

        set_result = self.run_config("set-key", input_text=f"{secret}\n")
        status_result = self.run_config("status")

        env_path = self.xdg_home / "tikin" / ".env"
        self.assertIn("TIKIN_API_KEY=secret-from-stdin", env_path.read_text())
        self.assertEqual(stat.S_IMODE(env_path.stat().st_mode), 0o600)
        self.assertEqual(
            json.loads(status_result.stdout),
            {
                "key_configured": True,
                "key_source": "file",
                "settings": {"routing": {"default": "auto", "platforms": {}}},
            },
        )
        for output in (set_result.stdout, set_result.stderr, status_result.stdout):
            self.assertNotIn(secret, output)

    def test_status_only_returns_known_non_secret_settings(self):
        config_dir = self.xdg_home / "tikin"
        config_dir.mkdir(parents=True)
        settings_path = config_dir / "settings.json"
        settings_path.write_text(
            json.dumps(
                {
                    "routing": {"default": "auto", "platforms": {}},
                    "future_secret": "do-not-print-this",
                }
            )
        )

        result = self.run_config("status")

        self.assertNotIn("do-not-print-this", result.stdout)
        self.assertEqual(
            json.loads(result.stdout)["settings"],
            {"routing": {"default": "auto", "platforms": {}}},
        )

    def test_environment_key_wins_and_set_key_preserves_other_env_values(self):
        config_dir = self.xdg_home / "tikin"
        config_dir.mkdir(parents=True)
        env_path = config_dir / ".env"
        env_path.write_text(
            "TIKIN_BASE_URL=https://private.example\nTIKIN_API_KEY=file-secret\n"
        )
        process_env = self.env.copy()
        process_env["TIKIN_API_KEY"] = "process-secret"

        status_result = self.run_config("status", env=process_env)
        self.run_config("set-key", input_text="replacement-secret\n")

        self.assertEqual(json.loads(status_result.stdout)["key_source"], "environment")
        self.assertNotIn("process-secret", status_result.stdout)
        self.assertNotIn("file-secret", status_result.stdout)
        self.assertIn("TIKIN_BASE_URL=https://private.example", env_path.read_text())
        self.assertIn("TIKIN_API_KEY=replacement-secret", env_path.read_text())

    def test_init_repairs_existing_env_file_permissions_without_echoing_it(self):
        config_dir = self.xdg_home / "tikin"
        config_dir.mkdir(parents=True)
        env_path = config_dir / ".env"
        secret = "existing-secret"
        env_path.write_text(f"TIKIN_API_KEY={secret}\n")
        env_path.chmod(0o644)

        result = self.run_config("init")

        self.assertEqual(stat.S_IMODE(env_path.stat().st_mode), 0o600)
        self.assertNotIn(secret, result.stdout)
        self.assertNotIn(secret, result.stderr)

    def test_init_restricts_legacy_env_when_dotenv_already_exists(self):
        config_dir = self.xdg_home / "tikin"
        config_dir.mkdir(parents=True)
        legacy_path = config_dir / "env"
        env_path = config_dir / ".env"
        legacy_path.write_text("TIKIN_API_KEY=legacy-secret\n")
        env_path.write_text("TIKIN_API_KEY=current-secret\n")
        legacy_path.chmod(0o644)

        self.run_config("init")

        self.assertEqual(env_path.read_text(), "TIKIN_API_KEY=current-secret\n")
        self.assertEqual(stat.S_IMODE(legacy_path.stat().st_mode), 0o600)

    def test_routing_supports_global_defaults_and_platform_overrides(self):
        self.run_config("init")
        self.assertEqual(self.run_config("get-policy", "xiaohongshu").stdout.strip(), "auto")

        self.run_config(
            "set-routing",
            "--default",
            "confirm",
            "--platform",
            "xiaohongshu=auto",
            "--platform",
            "instagram=auto",
        )

        self.assertEqual(self.run_config("get-policy", "xiaohongshu").stdout.strip(), "auto")
        self.assertEqual(self.run_config("get-policy", "instagram").stdout.strip(), "auto")
        self.assertEqual(self.run_config("get-policy", "youtube").stdout.strip(), "confirm")
        settings_path = self.xdg_home / "tikin" / "settings.json"
        self.assertEqual(
            json.loads(settings_path.read_text()),
            {
                "routing": {
                    "default": "confirm",
                    "platforms": {"instagram": "auto", "xiaohongshu": "auto"},
                }
            },
        )

    def test_init_refuses_to_migrate_a_legacy_env_symlink(self):
        config_dir = self.xdg_home / "tikin"
        config_dir.mkdir(parents=True)
        outside = Path(self.tempdir.name) / "outside-secret"
        outside.write_text("TIKIN_API_KEY=outside-secret\n")
        (config_dir / "env").symlink_to(outside)

        result = self.run_config("init", check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((config_dir / ".env").exists())
        self.assertEqual(outside.read_text(), "TIKIN_API_KEY=outside-secret\n")
        self.assertNotIn("outside-secret", result.stdout)
        self.assertNotIn("outside-secret", result.stderr)

    def test_validate_checks_the_key_without_echoing_it(self):
        secret = "validation-secret"

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if (
                    self.path == "/api/usage/token/"
                    and self.headers.get("Authorization") == f"Bearer {secret}"
                ):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')
                else:
                    self.send_response(401)
                    self.end_headers()

            def log_message(self, _format, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

        config_dir = self.xdg_home / "tikin"
        config_dir.mkdir(parents=True)
        (config_dir / ".env").write_text(
            f"TIKIN_API_KEY={secret}\n"
            f"TIKIN_BASE_URL=http://127.0.0.1:{server.server_port}\n"
        )

        result = self.run_config("validate")

        self.assertEqual(result.stdout.strip(), "valid")
        self.assertNotIn(secret, result.stdout)
        self.assertNotIn(secret, result.stderr)


if __name__ == "__main__":
    unittest.main()
