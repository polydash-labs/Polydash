#!/usr/bin/env python3
"""High-confidence secret scan for this repository.

Flags private-key blocks, live cloud tokens, and assigned secrets that are not
placeholders. Does not flag addresses, transaction hashes, or example env files
whose values are empty or obviously fake. Standard-library only.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKIP_DIRS = {
    ".git",
    "lib",
    "node_modules",
    "out",
    "cache",
    "broadcast",
    ".next",
    "coverage",
    "venv",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
}

SKIP_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".woff",
    ".woff2",
    ".pdf",
    ".zip",
}

# Built without a contiguous "BEGIN ... PRIVATE KEY" literal so this file does not flag itself.
PEM = "-----BEGIN " + "PRIVATE KEY-----"
RSA_PEM = "-----BEGIN " + "RSA PRIVATE KEY-----"
OPENSSH_PEM = "-----BEGIN " + "OPENSSH PRIVATE KEY-----"

ASSIGNMENT = re.compile(
    r"(?i)\b(?:private[_-]?key|api[_-]?key|secret[_-]?key|mnemonic|seed[_-]?phrase|access[_-]?key)\b\s*[=:]\s*['\"]?([^\s'\"]+)"
)
AWS_ACCESS_KEY = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
GITHUB_TOKEN = re.compile(r"\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b")
SLACK_TOKEN = re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")
LIVE_SK = re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")
HEX_KEY_ASSIGNMENT = re.compile(
    r"(?i)\b(?:private[_-]?key|deployer[_-]?key)\b\s*[=:]\s*['\"]?(0x[a-f0-9]{64})\b"
)

PLACEHOLDER_BITS = (
    "your_",
    "changeme",
    "placeholder",
    "example",
    "todo",
    "redacted",
    "xxx",
    "<",
    "0000000000000000000000000000000000000000",
)


def _skipped(path: Path) -> bool:
    if any(part in SKIP_DIRS for part in path.parts):
        return True
    return path.suffix.lower() in SKIP_SUFFIXES


def _placeholder(value: str) -> bool:
    lowered = value.lower()
    return any(bit in lowered for bit in PLACEHOLDER_BITS) or value in {"", "none", "null"}


def scan_text(rel: str, text: str) -> list[str]:
    findings: list[str] = []
    for needle, label in ((PEM, "PEM private key"), (RSA_PEM, "RSA private key"), (OPENSSH_PEM, "OpenSSH private key")):
        if needle in text:
            findings.append(f"{rel}: {label}")
    for i, line in enumerate(text.splitlines(), start=1):
        if AWS_ACCESS_KEY.search(line):
            findings.append(f"{rel}:{i}: AWS access key id")
        if GITHUB_TOKEN.search(line):
            findings.append(f"{rel}:{i}: GitHub token")
        if SLACK_TOKEN.search(line):
            findings.append(f"{rel}:{i}: Slack token")
        if LIVE_SK.search(line):
            findings.append(f"{rel}:{i}: API key")
        hex_hit = HEX_KEY_ASSIGNMENT.search(line)
        if hex_hit and not _placeholder(hex_hit.group(1)):
            findings.append(f"{rel}:{i}: assigned hex private key")
        assigned = ASSIGNMENT.search(line)
        if assigned and not _placeholder(assigned.group(1)):
            value = assigned.group(1)
            if value.startswith("0x") and len(value) == 42:
                continue
            if len(value) >= 12:
                findings.append(f"{rel}:{i}: assigned secret ({assigned.group(0).split('=')[0].strip()})")
    return findings


def iter_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or _skipped(path.relative_to(ROOT)):
            continue
        files.append(path)
    return files


def main() -> int:
    findings: list[str] = []
    for path in iter_files():
        rel = path.relative_to(ROOT).as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        findings.extend(scan_text(rel, text))
    if findings:
        print("Secret scan failed:")
        for item in findings:
            print(f"  {item}")
        return 1
    print(f"Secret scan passed ({len(list(iter_files()))} files).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
