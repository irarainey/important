"""
Complex example demonstrating various import violations with aliases and multiline imports.

This file contains intentional violations for testing the Important extension:
- Non-standard import aliases
- Unnecessary from-import aliases  
- Multiline imports with symbol imports (not module imports)
- Deep namespace imports
- Various ordering and styling issues

Run "Important: Fix Imports in This File" to see the extension in action.
"""

# fmt: off

# ⚠️ VIOLATION: Non-standard alias (should be 'np')
import numpy as n

# ⚠️ VIOLATION: Non-standard alias (no standard alias exists for json)
import json as j

# ⚠️ VIOLATION: Multiple imports on one line with aliases
import datetime as dt, collections as col

# ⚠️ VIOLATION: Wrong order (third-party before stdlib) + alias
import pandas as pd
import logging as log

# ⚠️ VIOLATION: Deep namespace import - symbol import from deep path
# Should be: from services.api.handlers import user_handler
from services.api.handlers.user_handler import (
    UserRequest,
    UserResponse,
    UserListResponse,
    UserRole,
)

# ⚠️ VIOLATION: Deep namespace symbol import (single line)
from services.api.handlers.project_handler import ProjectRequest, ProjectResponse

# ⚠️ VIOLATION: Unnecessary alias - no name conflict exists
from services.api.handlers.project_handler import ProjectSummary as ProjSummary

# ⚠️ VIOLATION: Unnecessary alias + multiline
from services.api.handlers.project_handler import (
    ProjectMetadata as ProjMeta,
)

# ⚠️ VIOLATION: Local model imports
# ⚠️ VIOLATION: First-party symbol imports with multiline
from models.sample_models import User, Config, Project, Task
from other_library.core.base import (
    BaseProcessor,
    ProcessorConfig,
)

# ⚠️ VIOLATION: First-party symbol imports
from other_library.core.exceptions import ProcessingError, ValidationError

# ⚠️ VIOLATION: First-party utils symbol imports with aliases
from other_library.utils.formatting import format_output as fmt_out
from other_library.utils.validation import validate_input as validate, is_valid_email

# ✅ CORRECT: Standard abbreviation alias
import matplotlib.pyplot as plt

# ✅ CORRECT: typing exemption (symbols allowed)
from typing import (
    List,
    Dict,
    Optional,
    Any,
)

# ✅ CORRECT: collections.abc exemption
from collections.abc import Mapping, Sequence

# fmt: on


class DataAnalyzer(BaseProcessor[Dict[str, Any]]):
    """Analyzes data using various pandas operations."""

    def __init__(self, name: str, batch_size: int = 50) -> None:
        config = ProcessorConfig(
            name=name, batch_size=batch_size, verbose=True)
        super().__init__(config)
        self.dataframe: Optional[pd.DataFrame] = None

    def process(self, item: Any) -> Dict[str, Any]:
        """Process a single data item."""
        if not validate(item, dict):
            raise ValidationError("Expected dict input", field="item")
        return {"processed": True, "data": item}

    def load_data(self, data: List[Dict[str, Any]]) -> None:
        """Load data into a pandas DataFrame."""
        self.dataframe = pd.DataFrame(data)
        log.info("Loaded %d rows", len(self.dataframe))

    def analyze(self) -> Dict[str, Any]:
        """Perform analysis on loaded data."""
        if self.dataframe is None:
            raise ProcessingError("No data loaded")

        # Use numpy for calculations
        values = n.array(self.dataframe.values)
        mean_val = n.mean(values, axis=0) if values.size > 0 else n.array([])

        # Use datetime alias
        timestamp = dt.datetime.now().isoformat()

        # Use collections alias
        counter = col.Counter(self.dataframe.columns)

        return {
            "timestamp": timestamp,
            "shape": self.dataframe.shape,
            "mean": mean_val.tolist(),
            "columns": dict(counter),
        }


def create_user_request(name: str, email: str, role_str: str = "user") -> UserRequest:
    """Create a user request with validation."""
    if not is_valid_email(email):
        raise ValidationError(f"Invalid email: {email}", field="email")

    role = UserRole(role_str)
    return UserRequest(name=name, email=email, role=role)


def create_project_request(
    name: str,
    description: str,
    owner: User,
) -> ProjectRequest:
    """Create a project request from user data."""
    return ProjectRequest(
        name=name,
        description=description,
        owner_id=owner.id,
    )


def get_project_summary(project: Project, tasks: List[Task]) -> ProjSummary:
    """Get a summary of a project."""
    completed = sum(1 for t in tasks if t.completed)
    return ProjSummary(
        id=1,
        name=project.name,
        task_count=len(tasks),
        completed_count=completed,
    )


def format_response(response: UserResponse) -> str:
    """Format a user response for display."""
    data = {
        "id": response.id,
        "name": response.name,
        "email": response.email,
        "role": response.role.value,
    }
    return fmt_out(data, indent=4)


def create_metadata(tags: List[str]) -> ProjMeta:
    """Create project metadata."""
    now = dt.datetime.now()
    return ProjMeta(created_at=now, updated_at=now, tags=tags)


def plot_analysis(analyzer: DataAnalyzer) -> None:
    """Plot analysis results using matplotlib."""
    results = analyzer.analyze()

    # Create a simple bar plot
    fig, ax = plt.subplots()
    columns = list(results["columns"].keys())
    counts = list(results["columns"].values())
    ax.bar(columns, counts)
    ax.set_title(f"Analysis at {results['timestamp']}")
    plt.tight_layout()


def verify_types(data: Mapping[str, Sequence[int]]) -> bool:
    """Verify that data matches expected types."""
    for key, values in data.items():
        if not isinstance(key, str):
            return False
        if not all(isinstance(v, int) for v in values):
            return False
    return True


def main() -> None:
    """Main function demonstrating complex import usage."""
    log.basicConfig(level=log.INFO)
    logger = log.getLogger(__name__)

    # Create sample data using json alias
    data_str = j.dumps({"name": "Test", "value": 42})
    data = j.loads(data_str)
    logger.info("Parsed data: %s", data)

    # Create users and projects
    user = User(id=1, name="Alice", email="alice@example.com")
    config = Config(debug=True, log_level="DEBUG")
    logger.info("User: %s, Config: %s", user, config)

    # Create project with tasks
    project = Project(name="Analysis", owner=user,
                      description="Data analysis project")
    tasks = [
        Task(title="Load data", project=project, assignee=user, completed=True),
        Task(title="Analyze", project=project, assignee=user),
        Task(title="Report", project=project),
    ]

    # Get project summary
    summary = get_project_summary(project, tasks)
    logger.info("Project completion: %.1f%%", summary.completion_rate)

    # Create and run analyzer
    analyzer = DataAnalyzer(name="main_analyzer")
    sample_data = [
        {"a": 1, "b": 2, "c": 3},
        {"a": 4, "b": 5, "c": 6},
    ]
    analyzer.load_data(sample_data)

    results = analyzer.analyze()
    logger.info("Analysis results: %s", fmt_out(results))

    # Verify types using collections.abc
    mapping_data: Dict[str, List[int]] = {"values": [1, 2, 3]}
    logger.info("Types valid: %s", verify_types(mapping_data))


if __name__ == "__main__":
    main()
