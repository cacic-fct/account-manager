#!/usr/bin/env python3
"""Validate the prebuilt PDF verification runtime without mutating it."""

import importlib
import json
import sys


def check_environment():
    missing_packages = []
    for package in ("pypdf", "reportlab"):
        try:
            importlib.import_module(package)
        except ImportError:
            missing_packages.append(package)

    if missing_packages:
        return {
            "success": False,
            "error": "Missing Python packages: " + ", ".join(missing_packages),
        }

    return {
        "success": True,
        "python_path": sys.executable,
        "message": "Python environment ready",
    }


if __name__ == "__main__":
    print(json.dumps(check_environment()))
