"""
Noqa comment examples — inline suppression of specific violations.

This file tests the `# noqa: important` and `# noqa: important[rule-code]`
inline comment feature. Some imports are intentionally suppressed while
others remain as violations for testing.

Expected behaviour:
- Lines with `# noqa: important` suppress ALL violations on that import.
- Lines with `# noqa: important[rule-code]` suppress only that specific rule.
- Lines WITHOUT noqa are still flagged as normal.
"""

# fmt: off

# ===============================================
# BLANKET NOQA — Suppress all rules on the line
# ===============================================

# ✅ SUPPRESSED: Wildcard import — normally a violation, but blanket noqa silences it.
from os.path import *  # noqa: important

# ✅ SUPPRESSED: Unused import — kept intentionally for side effects.
import logging  # noqa: important

# ✅ SUPPRESSED: Wrong order (third-party before stdlib) — ignore ordering here.
import requests  # noqa: important
import pathlib

# ===============================================
# PER-RULE NOQA — Suppress only specific rules
# ===============================================

# ✅ SUPPRESSED: Symbol import allowed here; but still an ordering violation
# if out of order — only import-modules-not-symbols is suppressed.
from models.sample_models import User, Config  # noqa: important[import-modules-not-symbols]

# ✅ SUPPRESSED: Unused import suppressed, but the import itself is fine.
import collections  # noqa: important[unused-import]

# ⚠️ VIOLATION: Non-standard alias — this one is NOT suppressed.
import numpy as num

# ✅ SUPPRESSED: Multiple rules suppressed at once via comma-separated codes.
from os import getcwd, getenv  # noqa: important[import-modules-not-symbols, unused-import]

# ===============================================
# NOQA ON MULTILINE IMPORTS
# ===============================================

# ✅ SUPPRESSED: Multiline import with noqa on the opening line.
from services.api.handlers.user_handler import (  # noqa: important
    UserRequest,
    UserResponse,
)

# ✅ SUPPRESSED: Multiline import with noqa on the closing line.
from services.api.handlers.project_handler import (
    ProjectRequest,
    ProjectResponse,
)  # noqa: important[import-modules-not-symbols]

# ===============================================
# MIXED — Some suppressed, some not
# ===============================================

# ⚠️ VIOLATION: Relative import — NOT suppressed.
from .utils import format_text

# ✅ SUPPRESSED: Relative import — suppressed by noqa.
from .helpers import helpers  # noqa: important[no-relative-imports]

# ⚠️ VIOLATION: Unnecessary from-alias — NOT suppressed.
from json import loads as json_loads

# ✅ SUPPRESSED: Unnecessary from-alias — suppressed by per-rule noqa.
from json import dumps as json_dumps  # noqa: important[unnecessary-from-alias]

# ⚠️ VIOLATION: Non-standard alias for datetime (should be 'dt').
import datetime as date

# ✅ SUPPRESSED: Non-standard alias — suppressed.
import datetime as dtime  # noqa: important[non-standard-import-alias]

# fmt: on


# ── Usage section — keep imports from being flagged as unused ──

print(pathlib.Path.cwd())

user = User(name="Alice", email="alice@example.com")
config = Config(debug=True)

print(user, config)

print(num.array([1, 2, 3]))

print(UserRequest, UserResponse)
print(ProjectRequest, ProjectResponse)

format_text("hello")
helpers.do_something()

data = json_loads('{"key": "value"}')
print(json_dumps(data))

print(date.datetime.now())
print(dtime.datetime.now())
