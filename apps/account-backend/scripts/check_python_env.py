#!/usr/bin/env python3
"""
Check if required Python packages are installed and install them if needed.
"""

import subprocess
import sys
import os
import venv
from pathlib import Path

def log_status(message):
    """Log setup progress without polluting stdout JSON consumed by Nest."""
    print(message, file=sys.stderr)

def check_and_install_packages():
    """Check if required packages are available and install them if needed."""
    
    # Get the script directory
    script_dir = Path(__file__).parent
    venv_dir = script_dir / "venv"
    requirements_file = script_dir / "requirements.txt"
    
    # Create virtual environment if it doesn't exist
    if not venv_dir.exists():
        log_status("Virtual environment not found. Creating...")
        try:
            venv.create(str(venv_dir), with_pip=True)
            log_status("Virtual environment created successfully.")
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to create virtual environment: {str(e)}"
            }
    
    # Determine Python executable path based on OS
    if sys.platform == "win32":
        python_path = venv_dir / "Scripts" / "python.exe"
        pip_path = venv_dir / "Scripts" / "pip.exe"
    else:
        python_path = venv_dir / "bin" / "python"
        pip_path = venv_dir / "bin" / "pip"
    
    if not python_path.exists():
        return {
            "success": False,
            "error": f"Python executable not found in virtual environment at {python_path}"
        }
    
    # Install requirements if requirements.txt exists
    if requirements_file.exists():
        try:
            log_status("Installing Python requirements...")
            install_result = subprocess.run([
                str(pip_path), "install", "-r", str(requirements_file)
            ], capture_output=True, text=True, timeout=120)
            
            if install_result.returncode != 0:
                return {
                    "success": False,
                    "error": f"Failed to install requirements: {install_result.stderr}"
                }
            log_status("Requirements installed successfully.")
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": "Timeout while installing Python packages"
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Error installing requirements: {str(e)}"
            }
    
    return {
        "success": True,
        "python_path": str(python_path),
        "message": "Python environment ready"
    }

if __name__ == "__main__":
    result = check_and_install_packages()
    import json
    print(json.dumps(result, indent=2))
