"""
Main module with various import violations for testing.

Run "Important: Fix Imports in This File" to see the extension in action.
"""

# fmt: off

# ⚠️ VIOLATION: Multiple imports on one line
import os, sys, json

# ⚠️ VIOLATION: Wrong order (third-party before stdlib)
import requests
from collections import abc
import pathlib

# ⚠️ VIOLATION: Unused import
import collections

# ⚠️ VIOLATION: Wildcard import
from os.path import *

# ⚠️ VIOLATION: Import symbols, not modules
from models.sample_models import User, Config

# ⚠️ VIOLATION: Import symbols from first-party module
from sample_project import helpers

# ✅ CORRECT: Standard import
import logging

# fmt: on


def main() -> None:
    """Entry point with various import usages."""
    logger = logging.getLogger(__name__)

    # Use os, sys, json
    logger.info("OS: %s", os.name)
    logger.info("Python: %s", sys.version)
    logger.info("Config: %s", json.dumps({"debug": True}))

    # Use pathlib
    cwd = pathlib.Path.cwd()
    logger.info("Working directory: %s", cwd)

    # Use requests
    logger.info("Requests version: %s", requests.__version__)

    # From wildcard import
    logger.info("Absolute path: %s", abspath("."))

    # ⚠️ Using imported classes directly (violation of "import modules, not symbols")
    user = User(id=1, name="Alice", email="alice@example.com")
    config = Config(debug=True, log_level="DEBUG")
    logger.info("User: %s", user)
    logger.info("Config: %s", config)

    # Use collections.abc
    logger.info("Is dict a Mapping? %s", issubclass(dict, abc.Mapping))

    # ⚠️ Using first-party module symbol directly
    logger.info("Greeting: %s", helpers.greet("World"))
    logger.info("Sum: %d", helpers.add(2, 3))


if __name__ == "__main__":
    main()
