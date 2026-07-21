from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ai_providers import build_provider


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT = SCRIPT_DIR / "analyzer_output" / "ai-summary.md"
DEFAULT_OUTPUT = SCRIPT_DIR / "analyzer_output" / "action-items.md"


DEFAULT_PROMPT = """You are a senior site reliability engineer reviewing a summary of Jenkins log findings.

Read the findings summary from stdin and produce a separate, focused action-items response.

Requirements:
- Do not repeat the findings summary itself.
- For each distinct issue raised in the summary, provide at least one concrete fix.
- Order action items by priority/impact, most urgent first.
- For each action item include: the issue it addresses, the concrete fix/step, and a rough priority (High/Medium/Low).
- Call out any issues that are noisy/expected and therefore need no action.
- Use plain Markdown.
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate action items from a previously generated AI summary using a pluggable AI provider."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Path to the findings summary file (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Path to write the action items markdown (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Optional model name for the selected provider.",
    )
    parser.add_argument(
        "--provider",
        default="copilot",
        choices=["copilot", "bob"],
        help="AI provider to use (default: copilot for Microsoft Copilot).",
    )
    parser.add_argument(
        "--extra-instructions",
        default="",
        help="Extra text appended to the default action-items prompt.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the prompt and input without invoking an AI provider.",
    )
    parser.add_argument(
        "--show-prompt",
        action="store_true",
        help="Print the full prompt (system prompt + input) sent to the AI provider.",
    )
    return parser


def build_prompt(extra_instructions: str) -> str:
    prompt = DEFAULT_PROMPT.strip()
    if extra_instructions.strip():
        prompt = f"{prompt}\n\nAdditional instructions:\n{extra_instructions.strip()}"
    return prompt


def load_input(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(
            f"Input file not found: {path}\n"
            "Run summarize_with_ai.py first so it generates a findings summary."
        )
    content = path.read_text(encoding="utf-8").strip()
    if not content:
        raise ValueError(f"Input file is empty: {path}")
    return content


def main() -> int:
    args = build_parser().parse_args()
    prompt = build_prompt(args.extra_instructions)

    try:
        input_text = load_input(args.input)
    except (FileNotFoundError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.dry_run or args.show_prompt:
        print(f"Input: {args.input}")
        print(f"Output: {args.output}")
        print(f"Provider: {args.provider}")
        print("\n=== SYSTEM PROMPT ===\n")
        print(prompt)
        print("\n=== USER CONTENT (findings summary) ===\n")
        print(input_text)
        if args.dry_run:
            return 0

    try:
        provider = build_provider(args.provider)
        action_items = provider.summarize(input_text, prompt, args.model)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(action_items + "\n", encoding="utf-8")
    print(f"Wrote action items to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
