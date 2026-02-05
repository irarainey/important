"""
Demo file with fixable import violations.

This file contains import violations that the Important extension CAN auto-fix:
- Multiple imports on one line (import a, b, c)
- Relative imports (from .module import x)
- Symbol imports (from package.module import Symbol)

Run "Important: Fix Imports in This File" to see the fixes in action.
"""

# fmt: off
# ⚠️ VIOLATION: Multiple imports on one line - CAN BE FIXED
# Fix: Split into separate import statements
import os, sys, json

# ⚠️ VIOLATION: Multiple imports on one line - CAN BE FIXED
import pathlib, tempfile, shutil
# fmt: on

# ✅ CORRECT: Single import
import logging

# ⚠️ VIOLATION: Relative import - CAN BE FIXED
# Fix: Remove the leading dot(s)
from .models import User, Repository

# ⚠️ VIOLATION: Relative import - CAN BE FIXED
from .utils import pretty_json

# ⚠️ VIOLATION: Double-dot relative import - CAN BE FIXED
from ..other import something

# ⚠️ VIOLATION: Import modules, not symbols - CAN BE FIXED
# Should be: from sample_project import client
# Then use: client.HttpClient
from sample_project.client import HttpClient

# ⚠️ VIOLATION: Wildcard import - CANNOT BE AUTO-FIXED
# (Would need to know which names to import)
from os.path import *


def demo_function() -> None:
    """Use the imports to avoid unused import warnings."""
    logger = logging.getLogger(__name__)
    logger.info("OS: %s", os.name)
    logger.info("Python: %s", sys.version)
    logger.info("JSON: %s", json.dumps({"demo": True}))

    # Use pathlib, tempfile, shutil
    temp_dir = pathlib.Path(tempfile.gettempdir())
    logger.info("Temp dir: %s", temp_dir)

    # Would use the imported items here
    print(f"User: {User}, Repository: {Repository}")
    print(f"pretty_json: {pretty_json}")

    # Test the module import fix - HttpClient should become client.HttpClient
    print(f"HttpClient: {HttpClient}")
    client_instance = HttpClient("https://example.com")
    print(client_instance)

    # From wildcard import
    print(f"Current dir: {abspath('.')}")


if __name__ == "__main__":
    demo_function()
