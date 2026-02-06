#!/usr/bin/env bash
#
# Downloads standalone Python builds for all platforms.
# Uses python-build-standalone releases from GitHub.
#
# This script can build runtimes for ALL platforms from Linux by:
# 1. Downloading pre-built Python for each target platform
# 2. Installing pip packages using the LOCAL Python (cross-platform compatible)
# 3. Copying the pure-Python packages to each target platform's site-packages
#
# Usage:
#   ./scripts/download-python-standalone.sh [platforms...]
#   ./scripts/download-python-standalone.sh              # all platforms
#   ./scripts/download-python-standalone.sh linux darwin # specific platforms
#
# Environment variables:
#   KEEP_DOWNLOADS=1  - Keep downloaded archives after extraction
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
DOWNLOAD_DIR="$PROJECT_ROOT/.python-downloads"
PACKAGES_DIR="$PROJECT_ROOT/.python-packages"

# Python version and release tag
# Check https://github.com/indygreg/python-build-standalone/releases for latest
PYTHON_VERSION="3.11.9"
RELEASE_TAG="20240713"

# Base URL for downloads
BASE_URL="https://github.com/indygreg/python-build-standalone/releases/download/$RELEASE_TAG"

# Platform-specific archive names
declare -A ARCHIVES=(
    ["linux"]="cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-unknown-linux-gnu-install_only.tar.gz"
    ["darwin"]="cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-apple-darwin-install_only.tar.gz"
    ["darwin-arm64"]="cpython-${PYTHON_VERSION}+${RELEASE_TAG}-aarch64-apple-darwin-install_only.tar.gz"
    ["win"]="cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz"
)

# Packages to install (all pure Python, cross-platform compatible)
PACKAGES=(
    "isort"
)

mkdir -p "$DOWNLOAD_DIR"

# First, install packages locally using pip to get pure Python packages
install_packages_locally() {
    echo "=========================================="
    echo "Installing packages locally for copying..."
    echo "=========================================="
    
    rm -rf "$PACKAGES_DIR"
    mkdir -p "$PACKAGES_DIR"
    
    # Install packages to a local directory using system Python
    python3 -m pip install --target "$PACKAGES_DIR" "${PACKAGES[@]}" --quiet
    
    echo "Packages installed to $PACKAGES_DIR"
    echo ""
}

download_and_setup() {
    local platform="$1"
    local archive="${ARCHIVES[$platform]}"
    local url="$BASE_URL/$archive"
    local archive_path="$DOWNLOAD_DIR/$archive"
    local target_dir="$RUNTIME_DIR/$platform"
    
    echo "=========================================="
    echo "Setting up Python for: $platform"
    echo "=========================================="
    
    # Download if not already present
    if [[ ! -f "$archive_path" ]]; then
        echo "Downloading $archive..."
        curl -L -o "$archive_path" "$url"
    else
        echo "Using cached download: $archive"
    fi
    
    # Extract
    echo "Extracting to $target_dir..."
    rm -rf "$target_dir"
    mkdir -p "$target_dir"
    tar -xzf "$archive_path" -C "$target_dir" --strip-components=1
    
    # Recreate .gitkeep to preserve directory in git
    touch "$target_dir/.gitkeep"
    
    # Determine site-packages location
    local site_packages
    if [[ "$platform" == "win" ]]; then
        site_packages="$target_dir/Lib/site-packages"
    else
        site_packages="$target_dir/lib/python3.11/site-packages"
    fi
    
    # Copy pre-installed packages
    echo "Copying packages to site-packages..."
    cp -r "$PACKAGES_DIR"/* "$site_packages/"
    
    # Clean up to reduce size significantly
    echo "Cleaning up unnecessary files..."
    
    # Remove test directories
    find "$target_dir" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
    find "$target_dir" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
    find "$target_dir" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true
    find "$target_dir" -type d -name "idle_test" -exec rm -rf {} + 2>/dev/null || true
    
    # Remove compiled files
    find "$target_dir" -type f -name "*.pyc" -delete 2>/dev/null || true
    find "$target_dir" -type f -name "*.pyo" -delete 2>/dev/null || true
    find "$target_dir" -type f -name "*.a" -delete 2>/dev/null || true
    
    # Remove unnecessary components (not needed for isort)
    rm -rf "$target_dir/share" 2>/dev/null || true
    rm -rf "$target_dir/include" 2>/dev/null || true
    rm -rf "$target_dir/lib/tcl8.6" 2>/dev/null || true
    rm -rf "$target_dir/lib/tk8.6" 2>/dev/null || true
    rm -rf "$target_dir/lib/itcl4.2.3" 2>/dev/null || true
    rm -rf "$target_dir/lib/tdbc1.1.5" 2>/dev/null || true
    rm -rf "$target_dir/lib/tdbcmysql1.1.5" 2>/dev/null || true
    rm -rf "$target_dir/lib/tdbcodbc1.1.5" 2>/dev/null || true
    rm -rf "$target_dir/lib/tdbcpostgres1.1.5" 2>/dev/null || true
    rm -rf "$target_dir/lib/thread2.8.8" 2>/dev/null || true
    
    # Remove GUI/desktop modules (not needed for CLI tools)
    local lib_dir
    if [[ "$platform" == "win" ]]; then
        lib_dir="$target_dir/Lib"
    else
        lib_dir="$target_dir/lib/python3.11"
    fi
    
    rm -rf "$lib_dir/tkinter" 2>/dev/null || true
    rm -rf "$lib_dir/idlelib" 2>/dev/null || true
    rm -rf "$lib_dir/turtledemo" 2>/dev/null || true
    rm -rf "$lib_dir/ensurepip" 2>/dev/null || true
    rm -rf "$lib_dir/lib2to3" 2>/dev/null || true
    
    # Report size
    echo "Size after cleanup: $(du -sh "$target_dir" | cut -f1)"
    echo ""
}

# Parse arguments - default to all platforms
if [[ $# -eq 0 ]]; then
    PLATFORMS=("linux" "darwin" "win")
else
    PLATFORMS=("$@")
fi

# Install packages locally first (cross-platform pure Python)
install_packages_locally

# Build each platform
for platform in "${PLATFORMS[@]}"; do
    if [[ -v "ARCHIVES[$platform]" ]]; then
        download_and_setup "$platform"
    else
        echo "Warning: Unknown platform '$platform', skipping."
    fi
done

echo "=========================================="
echo "Done! Python runtimes are ready in:"
echo "$RUNTIME_DIR"
echo ""
echo "Platform sizes:"
for platform in "${PLATFORMS[@]}"; do
    if [[ -d "$RUNTIME_DIR/$platform" ]]; then
        echo "  $platform: $(du -sh "$RUNTIME_DIR/$platform" | cut -f1)"
    fi
done
echo "=========================================="

# Clean up unless KEEP_DOWNLOADS is set
if [[ "${KEEP_DOWNLOADS:-}" != "1" ]]; then
    echo "Cleaning up downloaded archives and temp packages..."
    rm -rf "$DOWNLOAD_DIR"
    rm -rf "$PACKAGES_DIR"
    echo "Done."
fi
