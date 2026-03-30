#!/usr/bin/env python3
"""Scan repository for potential personal / secret data before publishing.

Usage:
  python tools/check_repo_public_ready.py
"""

import os
import re
from pathlib import Path

# basic keywords and patterns
KEYWORDS = [
    r"password", r"passwd", r"secret", r"api[_-]?key", r"apikey", r"token", r"private", r"credential", r"ssh[-_]rsa", r"aws[_-]?access[_-]?key", r"aws[_-]?secret[_-]?access[_-]?key"
]
EMAIL = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
PHONE = re.compile(r"(?:\+\d{1,3}[\s-]?)?(?:\(\d{1,4}\)[\s-]?)?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{2,4}")
CREDIT_CARD = re.compile(r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12}|3(?:0[0-5]|[68][0-9])[0-9]{11})\b")
SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")

EXCLUDE_DIRS = {".git", "__pycache__", "node_modules", "dist", "build"}
OUTPUT_LIMIT_PER_FILE = 20


def is_binary_path(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            chunk = f.read(1024)
            if b"\0" in chunk:
                return True
            text_chars = bytearray({7,8,9,10,12,13,27} | set(range(0x20,0x100)))
            return bool(chunk) and all(c in text_chars for c in chunk)
    except Exception:
        return True


def scan_file(path: Path):
    findings = []
    if not path.is_file():
        return findings

    try:
        text = path.read_text(errors="replace")
    except Exception:
        return findings

    for i, line in enumerate(text.splitlines(), start=1):
        lower = line.lower()

        for kw in KEYWORDS:
            if re.search(kw, lower):
                findings.append((i, line.strip(), f"keyword: {kw}"))
                break

        if EMAIL.search(line):
            findings.append((i, line.strip(), "email"))
        if PHONE.search(line):
            findings.append((i, line.strip(), "phone-like"))
        if CREDIT_CARD.search(line):
            findings.append((i, line.strip(), "credit-card-like"))
        if SSN.search(line):
            findings.append((i, line.strip(), "ssn"))

        if len(findings) >= OUTPUT_LIMIT_PER_FILE:
            break

    return findings


def main():
    root = Path(__file__).resolve().parent.parent
    results = []

    for path in root.rglob("*"):
        if any(part in EXCLUDE_DIRS for part in path.parts):
            continue
        if path.is_dir():
            continue
        if path.name.startswith(".") and root == path.parent:
            continue

        if is_binary_path(path):
            continue

        file_findings = scan_file(path)
        if file_findings:
            results.append((path.relative_to(root), file_findings))

    if not results:
        print("No suspicious patterns detected.")
        return

    print("Potentially sensitive output found:")
    for path, hits in results:
        print(f"\n{path} ({len(hits)} matches):")
        for ln, line, kind in hits[:OUTPUT_LIMIT_PER_FILE]:
            print(f"  {ln}: [{kind}] {line}")

    print("\nCheck the matches and remove/mask secrets before public release.")


if __name__ == "__main__":
    main()
