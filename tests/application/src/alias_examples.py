"""
Alias examples demonstrating import alias validation rules.

This file tests:
- Standard import aliases (allowed: np, pd, plt, tf)
- Non-standard import aliases (flagged)
- Unnecessary from-import aliases (flagged when no conflict)
- Valid from-import aliases (allowed when name conflict exists)
"""

# fmt: off

# ===============================================
# STANDARD ALIASES — Should be accepted
# ===============================================

# ✅ CORRECT: Well-known standard abbreviations
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import tensorflow as tf
import seaborn as sns

# ===============================================
# NON-STANDARD ALIASES — Should be flagged
# ===============================================

# ⚠️ VIOLATION: Non-standard alias for numpy (should be 'np')
import numpy as num

# ⚠️ VIOLATION: Non-standard alias - no standard exists
import os as operating_system

# ⚠️ VIOLATION: Non-standard alias - only 'np' is standard for numpy
import numpy as npy

# ⚠️ VIOLATION: datetime alias 'dt' is standard but this uses 'date'
import datetime as date

# ===============================================
# UNNECESSARY FROM-ALIASES — Should be flagged  
# ===============================================

# ⚠️ VIOLATION: Unnecessary alias - 'datetime' has no conflict in this file
from datetime import datetime as dt_datetime

# ⚠️ VIOLATION: Unnecessary alias - 'loads' has no conflict
from json import loads as json_loads

# ⚠️ VIOLATION: Unnecessary alias - just shortening
from collections import OrderedDict as OD

# ===============================================
# VALID FROM-ALIASES — Should be accepted
# ===============================================

# These two imports share 'datetime' name - aliasing is justified
from datetime import datetime as DateTime
from datetime import date as Date  # Different import, same module

# Note: In real code, the DateTime alias above is actually valid because
# there would be a conflict with the `datetime` module itself if you also
# had `import datetime`. Let's demonstrate a clearer conflict:

# These conflict with each other:
from os import path as os_path
from pathlib import Path as pathlib_path

# ===============================================
# TYPING EXEMPTIONS — Always allowed
# ===============================================

# ✅ CORRECT: typing module is exempt - symbols can be imported directly
from typing import (
    List,
    Dict,
    Optional,
    Union,
    Any,
    Callable,
    TypeVar,
    Generic,
)

# ✅ CORRECT: typing_extensions is exempt
from typing_extensions import Literal, TypedDict

# ✅ CORRECT: collections.abc is exempt
from collections.abc import Mapping, MutableMapping, Sequence

# fmt: on

T = TypeVar("T")


class DataContainer(Generic[T]):
    """Generic data container."""

    def __init__(self, data: List[T]) -> None:
        self.data = data

    def to_dataframe(self) -> pd.DataFrame:
        """Convert to pandas DataFrame."""
        return pd.DataFrame(self.data)

    def to_array(self) -> np.ndarray:
        """Convert to numpy array."""
        return np.array(self.data)


def analyze_data(container: DataContainer[Dict[str, Any]]) -> Dict[str, Any]:
    """Analyze container data."""
    df = container.to_dataframe()
    arr = container.to_array()

    return {
        "shape": df.shape,
        "mean": np.mean(arr) if arr.size > 0 else 0,
        "columns": list(df.columns),
    }


def plot_results(data: Dict[str, Any]) -> None:
    """Plot analysis results."""
    fig, ax = plt.subplots(figsize=(10, 6))

    # Use sns for styling
    sns.set_theme()

    if "mean" in data:
        ax.axhline(y=data["mean"], color="r", linestyle="--")

    ax.set_title("Analysis Results")
    plt.tight_layout()


def process_path(filepath: Union[str, pathlib_path]) -> str:
    """Process a file path from either module."""
    # This demonstrates why the alias is needed - both 'path' and 'Path' could conflict
    if isinstance(filepath, pathlib_path):
        return filepath.as_posix()  # pathlib_path
    return filepath  # already a str


def load_json_data(json_str: str) -> Dict[str, Any]:
    """Load JSON data using aliased function."""
    return json_loads(json_str)


def create_ordered_config() -> OD:
    """Create an ordered configuration dict."""
    return OD([
        ("debug", True),
        ("log_level", "INFO"),
        ("timeout", 30),
    ])


def format_datetime(dt_obj: DateTime) -> str:
    """Format a datetime object."""
    return dt_obj.isoformat()


def format_date(date_obj: Date) -> str:
    """Format a date object."""
    return date_obj.isoformat()


def validate_mapping(data: Mapping[str, Any]) -> bool:
    """Validate that data is a proper mapping."""
    return isinstance(data, MutableMapping) or isinstance(data, Mapping)


def main() -> None:
    """Main function demonstrating alias usage."""
    # Use non-standard aliases (violations)
    arr = num.array([1, 2, 3])  # Should use np
    print(f"Array: {arr}")

    # Use operating_system alias
    print(f"OS name: {operating_system.name}")

    # Use standard aliases
    df = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})
    print(f"DataFrame shape: {df.shape}")

    # Use numpy properly
    mean = np.mean(df.values)
    print(f"Mean: {mean}")

    # Use datetime aliases
    now = DateTime.now()
    today = Date.today()
    print(f"Now: {format_datetime(now)}, Today: {format_date(today)}")

    # Use the wrong datetime alias
    wrong_now = date.datetime.now()
    print(f"Wrong alias datetime: {wrong_now}")


if __name__ == "__main__":
    main()
