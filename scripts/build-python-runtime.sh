#!/usr/bin/env bash
#
# Build script for bundling Python runtime and isort.
# Run this script on each target platform (or use cross-compilation).
#
# Usage:
#   ./scripts/build-python-runtime.sh [platform]
#
# Where platform is: linux, darwin, or win
#

set -euo pipefail

# Deactivate any active virtual environment to ensure we use system Python
if [[ -n "${VIRTUAL_ENV:-}" ]]; then
    echo "Deactivating virtual environment: $VIRTUAL_ENV"
    unset VIRTUAL_ENV
    # Remove venv from PATH
    PATH=$(echo "$PATH" | tr ':' '\n' | grep -v '.venv' | tr '\n' ':')
    PATH=${PATH%:}  # Remove trailing colon
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUNTIME_DIR="$PROJECT_ROOT/python-runtime"

# Python version to use
PYTHON_VERSION="3.11"

# Packages to install
PACKAGES=(
    "isort"
)

# Detect or use provided platform
detect_platform() {
    case "$(uname -s)" in
        Linux*)  echo "linux" ;;
        Darwin*) echo "darwin" ;;
        MINGW*|CYGWIN*|MSYS*) echo "win" ;;
        *)       echo "unknown" ;;
    esac
}

PLATFORM="${1:-$(detect_platform)}"

if [[ "$PLATFORM" == "unknown" ]]; then
    echo "Error: Unknown platform. Please specify: linux, darwin, or win"
    exit 1
fi

echo "Building Python runtime for: $PLATFORM"

TARGET_DIR="$RUNTIME_DIR/$PLATFORM"

# Clean existing runtime
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

case "$PLATFORM" in
    linux|darwin)
        # Create virtual environment using system Python
        echo "Creating virtual environment..."
        python3 -m venv "$TARGET_DIR"
        
        # Activate and install packages
        echo "Installing packages..."
        "$TARGET_DIR/bin/pip" install --upgrade pip
        "$TARGET_DIR/bin/pip" install "${PACKAGES[@]}"
        
        # Clean up unnecessary files to reduce size
        echo "Cleaning up..."
        find "$TARGET_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
        find "$TARGET_DIR" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
        find "$TARGET_DIR" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true
        find "$TARGET_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true
        find "$TARGET_DIR" -type f -name "*.pyo" -delete 2>/dev/null || true
        rm -rf "$TARGET_DIR/share" 2>/dev/null || true
        rm -rf "$TARGET_DIR/include" 2>/dev/null || true
        ;;
        
    win)
        # On Windows, create venv differently
        echo "Creating virtual environment..."
        python -m venv "$TARGET_DIR"
        
        echo "Installing packages..."
        "$TARGET_DIR/Scripts/pip.exe" install --upgrade pip
        "$TARGET_DIR/Scripts/pip.exe" install "${PACKAGES[@]}"
        
        # Clean up
        echo "Cleaning up..."
        find "$TARGET_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
        find "$TARGET_DIR" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
        find "$TARGET_DIR" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true
        rm -rf "$TARGET_DIR/share" 2>/dev/null || true
        rm -rf "$TARGET_DIR/include" 2>/dev/null || true
        ;;
esac

# Calculate size
echo ""
echo "Runtime built successfully!"
echo "Location: $TARGET_DIR"
echo "Size: $(du -sh "$TARGET_DIR" | cut -f1)"

# List installed packages
echo ""
echo "Installed packages:"
case "$PLATFORM" in
    linux|darwin)
        "$TARGET_DIR/bin/pip" list
        ;;
    win)
        "$TARGET_DIR/Scripts/pip.exe" list
        ;;
esac
