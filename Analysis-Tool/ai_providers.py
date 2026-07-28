from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


class AIProvider(ABC):
    """Common interface for AI backends used by analysis tooling."""

    @abstractmethod
    def summarize(self, input_text: str, prompt: str, model: Optional[str]) -> str:
        """Return a summary from provider output text."""


_GH_CLI_FALLBACK_PATHS = (
    "gh",
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
)


def _read_gh_auth_token() -> Optional[str]:
    """Best-effort token lookup from GitHub CLI auth state.

    Tries `gh` on PATH first, then common Homebrew install locations, since
    `gh` is not always on PATH in every shell/subprocess environment.
    """
    for gh_path in _GH_CLI_FALLBACK_PATHS:
        try:
            result = subprocess.run(
                [gh_path, "auth", "token"],
                capture_output=True,
                text=True,
                check=False,
            )
        except FileNotFoundError:
            continue

        if result.returncode != 0:
            continue

        token = result.stdout.strip()
        if token:
            return token

    return None


class BobProvider(AIProvider):
    def summarize(self, input_text: str, prompt: str, model: Optional[str]) -> str:
        command = [
            "bob",
            "--hide-intermediary-output",
            "--output-format",
            "text",
            "-p",
            prompt,
        ]
        if model:
            command.extend(["--model", model])

        try:
            result = subprocess.run(
                command,
                input=input_text,
                capture_output=True,
                text=True,
                check=False,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                "The 'bob' CLI was not found in PATH. Install or configure Bob first."
            ) from exc

        if result.returncode != 0:
            stderr = result.stderr.strip() or "Bob exited with a non-zero status."
            raise RuntimeError(stderr)

        summary = result.stdout.strip()
        if not summary:
            raise RuntimeError("Bob returned an empty summary.")
        return summary


@dataclass
class CopilotConfig:
    token: str
    base_url: str = "https://api.githubcopilot.com"
    path: str = "/chat/completions"
    model: str = "gpt-4o-mini"
    timeout_seconds: int = 60


class GitHubCopilotProvider(AIProvider):
    """
    GitHub Copilot chat-completions provider.

    Endpoint and auth are configurable via environment variables so this can
    adapt to org-specific Copilot gateways without code changes.
    """

    def __init__(self, config: CopilotConfig):
        self.config = config

    def summarize(self, input_text: str, prompt: str, model: Optional[str]) -> str:
        payload = {
            "model": model or self.config.model,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": input_text},
            ],
            "temperature": 0.2,
        }

        url = self.config.base_url.rstrip("/") + self.config.path
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url=url,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.config.token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=self.config.timeout_seconds,
            ) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"GitHub Copilot request failed with HTTP {exc.code}: {detail}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"GitHub Copilot request failed: {exc.reason}") from exc

        try:
            parsed = json.loads(raw)
            content = parsed["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError("GitHub Copilot response format was not recognized.") from exc

        if not content:
            raise RuntimeError("GitHub Copilot returned an empty summary.")
        return content


def build_provider(provider_name: str) -> AIProvider:
    normalized = provider_name.strip().lower()
    if normalized == "bob":
        return BobProvider()

    if normalized in {"copilot", "github-copilot", "github_copilot"}:
        token = (
            os.getenv("COPILOT_API_KEY")
            or os.getenv("GITHUB_TOKEN")
            or os.getenv("GH_TOKEN")
            or _read_gh_auth_token()
        )
        if not token:
            raise RuntimeError(
                "GitHub Copilot credentials are missing. Set COPILOT_API_KEY, GITHUB_TOKEN, or GH_TOKEN, or run 'gh auth login'."
            )

        base_url = os.getenv("COPILOT_API_BASE_URL", "https://api.githubcopilot.com")
        path = os.getenv("COPILOT_API_PATH", "/chat/completions")
        default_model = os.getenv("COPILOT_MODEL", "gpt-4o-mini")
        timeout_seconds = int(os.getenv("COPILOT_TIMEOUT_SECONDS", "60"))

        return GitHubCopilotProvider(
            CopilotConfig(
                token=token,
                base_url=base_url,
                path=path,
                model=default_model,
                timeout_seconds=timeout_seconds,
            )
        )

    raise RuntimeError(
        f"Unknown AI provider '{provider_name}'. Supported values: copilot, bob"
    )
