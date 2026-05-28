#!/bin/bash

# Setup Python virtual environment for PDF verification
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
REQUIREMENTS_FILE="$SCRIPT_DIR/requirements.txt"

echo "Setting up Python virtual environment for PDF verification..."

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed. Please install Python 3 to continue."
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "$VENV_DIR"
    if [ $? -ne 0 ]; then
        echo "Error: Failed to create virtual environment."
        exit 1
    fi
    echo "Virtual environment created successfully."
else
    echo "Virtual environment already exists."
fi

# Activate virtual environment
echo "Activating virtual environment..."
source "$VENV_DIR/bin/activate"

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install requirements
if [ -f "$REQUIREMENTS_FILE" ]; then
    echo "Installing Python requirements..."
    pip install -r "$REQUIREMENTS_FILE"
    if [ $? -eq 0 ]; then
        echo "Requirements installed successfully."
    else
        echo "Error: Failed to install requirements."
        exit 1
    fi
else
    echo "Error: requirements.txt not found at $REQUIREMENTS_FILE"
    exit 1
fi

echo "Python environment setup complete!"
echo "Virtual environment location: $VENV_DIR"
echo "To manually activate: source $VENV_DIR/bin/activate"
