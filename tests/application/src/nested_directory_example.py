"""
Nested directory name example — third-party module miscategorisation.

This file tests the fix where a deeply nested directory name matching
a third-party package caused that package to be miscategorised as
"local" instead of "third-party".

In this workspace, the directory `src/services/api/handlers/requests/`
exists, which means "requests" appears as a path segment. Previously,
`isLocalModule('requests')` indexed ALL path segments, so it would
incorrectly return true, categorising `import requests` as local.

Expected behaviour after fix:
- The import order below is CORRECT and should produce NO violations.
- `import datetime` is stdlib.
- `import requests` is third-party (NOT local, despite the nested dir).
- `from other_library import helpers` is first-party.
- `from src.services.api.handlers import user_handler` is local.
"""

# fmt: off

import datetime

import requests

from other_library import helpers

from src.services.api.handlers import user_handler

# Use all imports to avoid unused-import violations
timestamp = datetime.datetime.now()
response = requests.get("https://example.com")
formatted = helpers.greet(str(timestamp))
user = user_handler.UserRequest(name="test", email="test@test.com")
print(formatted, user, response)
