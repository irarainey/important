"""Command-line interface for the sample project."""

# ⚠️ VIOLATION: Wildcard import (no-wildcard-imports)
from os.path import *

# ✅ CORRECT: stdlib imports
import sys
from typing import Optional

# ✅ CORRECT: third-party imports
import click

# ⚠️ VIOLATION: Relative import (no-relative-imports)
from .client import HttpClient
from .models import User, Repository
from .utils import pretty_json, truncate_string


@click.group()
@click.version_option()
def main() -> None:
    """Sample Project CLI - Demo for Important VS Code extension."""
    pass


@main.command()
@click.argument("url")
@click.option("--timeout", "-t", default=30, help="Request timeout in seconds")
@click.option("--no-cache", is_flag=True, help="Disable caching")
def fetch(url: str, timeout: int, no_cache: bool) -> None:
    """Fetch data from a URL and display the response."""
    with HttpClient(url, timeout=timeout) as client:
        try:
            response = client.get("/", use_cache=not no_cache)
            click.echo(f"Status: {response.status_code}")
            click.echo(f"URL: {response.url}")
            click.echo(f"Content-Type: {response.content_type}")
            click.echo(f"Timestamp: {response.timestamp}")
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)


@main.command()
@click.argument("username")
def user(username: str) -> None:
    """Fetch GitHub user information."""
    with HttpClient("https://api.github.com") as client:
        try:
            data = client.get_json(f"/users/{username}")
            user_obj = User.model_validate(data)
            click.echo(f"User: {user_obj.login}")
            click.echo(f"Name: {user_obj.name or 'N/A'}")
            click.echo(f"Bio: {truncate_string(user_obj.bio or 'N/A', 80)}")
            click.echo(f"Repos: {user_obj.public_repos}")
            click.echo(f"Followers: {user_obj.followers}")
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)


@main.command()
@click.argument("owner")
@click.argument("repo")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def repo(owner: str, repo: str, as_json: bool) -> None:
    """Fetch GitHub repository information."""
    with HttpClient("https://api.github.com") as client:
        try:
            data = client.get_json(f"/repos/{owner}/{repo}")

            if as_json:
                click.echo(pretty_json(data))
            else:
                repo_obj = Repository.model_validate(data)
                click.echo(f"Repository: {repo_obj.full_name}")
                click.echo(
                    f"Description: {truncate_string(repo_obj.description or 'N/A', 80)}")
                click.echo(f"Language: {repo_obj.language or 'N/A'}")
                click.echo(f"Stars: {repo_obj.stargazers_count}")
                click.echo(f"Forks: {repo_obj.forks_count}")
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)


if __name__ == "__main__":
    main()
