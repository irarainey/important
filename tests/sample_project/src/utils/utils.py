"""
Utilities module demonstrating relative import and symbol import issues.
"""

# ⚠️ VIOLATION: Relative import
from main import main

# ⚠️ VIOLATION: Import symbols, not modules
from models.sample_models import User, create_user

# ⚠️ VIOLATION: Wrong alphabetical order
import json
import datetime
import collections


def process_data(data: dict) -> str:
    """Process data and return formatted output."""
    # Use imports
    timestamp = datetime.datetime.now().isoformat()
    counter = collections.Counter(data.keys())
    result = json.dumps({"timestamp": timestamp, "keys": dict(counter)})

    # Use imported class (violation example)
    user = create_user("Test", "test@example.com")
    print(f"Created user: {user}")

    # Create user directly using imported class
    new_user = User(id=2, name="Bob", email="bob@example.com")
    print(f"New user: {new_user}")

    main()
    return result
