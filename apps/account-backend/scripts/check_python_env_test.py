#!/usr/bin/env python3

import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).with_name("check_python_env.py")
SPEC = importlib.util.spec_from_file_location("check_python_env", SCRIPT_PATH)
check_python_env = importlib.util.module_from_spec(SPEC)
if SPEC.loader is None:
    raise RuntimeError("Unable to load check_python_env.py")

SPEC.loader.exec_module(check_python_env)


class CheckPythonEnvOutputTest(unittest.TestCase):
    def test_status_messages_use_stderr_and_stdout_remains_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            check_python_env.__file__ = str(temp_path / "check_python_env.py")
            (temp_path / "requirements.txt").write_text(
                "pdfplumber\n", encoding="utf-8"
            )

            def create_virtualenv(venv_path, with_pip):
                del with_pip
                scripts_dir = (
                    "Scripts" if check_python_env.sys.platform == "win32" else "bin"
                )
                python_name = (
                    "python.exe"
                    if check_python_env.sys.platform == "win32"
                    else "python"
                )
                pip_name = (
                    "pip.exe" if check_python_env.sys.platform == "win32" else "pip"
                )
                bin_path = Path(venv_path) / scripts_dir
                bin_path.mkdir(parents=True)
                (bin_path / python_name).touch()
                (bin_path / pip_name).touch()

            stdout = io.StringIO()
            stderr = io.StringIO()

            with (
                redirect_stdout(stdout),
                redirect_stderr(stderr),
                patch.object(
                    check_python_env.venv,
                    "create",
                    side_effect=create_virtualenv,
                ),
                patch.object(
                    check_python_env.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess(
                        args=[],
                        returncode=0,
                        stdout="",
                        stderr="",
                    ),
                ),
            ):
                result = check_python_env.check_and_install_packages()
                print(json.dumps(result, indent=2))

            parsed_output = json.loads(stdout.getvalue())

            self.assertTrue(parsed_output["success"])
            self.assertIn("python_path", parsed_output)
            self.assertIn(
                "Virtual environment not found. Creating...", stderr.getvalue()
            )
            self.assertIn("Installing Python requirements...", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
