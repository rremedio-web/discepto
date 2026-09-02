#!/usr/bin/env python3
"""Structural release checker for Discepto archives."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
from pathlib import Path

MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024

FORBIDDEN_SEGMENTS = {
    ".git",
    ".superpowers",
    "__MACOSX",
    ".DS_Store",
    "bundle",
    "cache",
    "build",
    "editor",
    "env",
}

ALLOWED_EXTENSIONS = frozenset(
    {".md", ".json", ".mjs", ".yml", ".html", ".py", ".sh"}
)
ALLOWED_BASENAMES = frozenset({"LICENSE", ".gitignore", ".nvmrc", ".prettierignore"})
ELF_MAGIC = b"\x7fELF"

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
ALLOWED_EMAIL_DOMAINS = frozenset(
    {"example.com", "example.org", "example.net", "example.invalid"}
)
HOME_SEGMENT_A = "/" + "Users" + "/"
HOME_SEGMENT_B = "/" + "home" + "/"
HOME_PATH_RE = re.compile(r"(?:%s|%s)" % (re.escape(HOME_SEGMENT_A), re.escape(HOME_SEGMENT_B)))
_SENSITIVE_KW = r"(?:api[_-]?key|secret|token|password)"
CREDENTIAL_PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rf"(?i){_SENSITIVE_KW}\s*[:=]\s*\S+"),
    re.compile(rf"""(?i)["']{_SENSITIVE_KW}["']\s*:\s*["'][^"']+["']"""),
    re.compile(rf"""(?i){_SENSITIVE_KW}\s*:\s*["'][^"']+["']"""),
    re.compile(rf"""(?i){_SENSITIVE_KW}\s*=\s*["'][^"']+["']"""),
    re.compile(r"[a-z]+://[^\s/:@]+:[^\s/@]+@"),
]


def email_domain_allowed(email: str) -> bool:
    if "@" not in email:
        return False
    domain = email.rsplit("@", 1)[1].lower()
    return domain in ALLOWED_EMAIL_DOMAINS


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def normalize_relpath(path: str) -> str:
    return path.replace("\\", "/")


def is_allowed_file(rel: str) -> bool:
    name = Path(rel).name
    if name in ALLOWED_BASENAMES:
        return True
    return Path(rel).suffix in ALLOWED_EXTENSIONS


def read_bytes_strict(path: Path) -> bytes:
    data = path.read_bytes()
    if b"\x00" in data:
        fail("NUL byte detected")
    if data.startswith(ELF_MAGIC):
        fail("unexpected binary content")
    return data


def decode_utf8_strict(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        fail("invalid UTF-8")


def check_paths(root: Path) -> list[str]:
    tracked_file = root / "tracked-files.txt"
    if not tracked_file.is_file():
        fail("tracked-files.txt missing")

    tracked_lines = tracked_file.read_text(encoding="utf-8").splitlines()
    tracked: list[str] = []
    seen: set[str] = set()
    seen_lower: set[str] = set()

    for line in tracked_lines:
        if not line.strip():
            continue
        rel = normalize_relpath(line.strip())
        if rel.startswith("/") or ".." in Path(rel).parts:
            fail("traversal path in tracked list")
        if "\\" in line:
            fail("backslash path in tracked list")
        if rel in seen:
            fail("duplicate path in tracked list")
        lower = rel.lower()
        if lower in seen_lower and lower != rel:
            fail("case collision in tracked list")
        seen.add(rel)
        seen_lower.add(lower)
        tracked.append(rel)

    actual_files: list[str] = []
    total_bytes = 0
    for dirpath, dirnames, filenames in os.walk(root):
        for name in filenames:
            full = Path(dirpath) / name
            rel = normalize_relpath(str(full.relative_to(root)))
            if rel == "tracked-files.txt":
                continue
            if full.is_symlink():
                fail("symlink detected")
            st = full.stat()
            if stat.S_ISFIFO(st.st_mode) or stat.S_ISSOCK(st.st_mode):
                fail("special file detected")
            size = st.st_size
            if size > MAX_FILE_BYTES:
                fail("file exceeds 16 MiB bound")
            total_bytes += size
            if total_bytes > MAX_TOTAL_BYTES:
                fail("archive exceeds 32 MiB total bound")
            actual_files.append(rel)

    actual_set = set(actual_files)
    tracked_set = set(tracked)
    if tracked_set != actual_set:
        fail("tracked-list mismatch")

    for rel in tracked:
        parts = Path(rel).parts
        for part in parts:
            if part in FORBIDDEN_SEGMENTS or part.startswith(".env"):
                fail("forbidden path segment")
        if rel.endswith(".zip"):
            fail("encrypted or compressed artifact in tracked set")
        if not is_allowed_file(rel):
            fail("unexpected file type")

    return tracked


def scan_content(root: Path, tracked: list[str]) -> None:
    for rel in tracked:
        data = read_bytes_strict(root / rel)
        text = decode_utf8_strict(data)
        if HOME_PATH_RE.search(text):
            fail("/Users or /home content detected")
        for match in EMAIL_RE.finditer(text):
            if not email_domain_allowed(match.group(0)):
                fail("non-example email domain detected")
        for pattern in CREDENTIAL_PATTERNS:
            if pattern.search(text):
                fail("credential pattern detected")


def scan_private_needles(root: Path, denylist_path: Path) -> None:
    needles = [
        line.strip()
        for line in denylist_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    for rel in root.rglob("*"):
        if not rel.is_file() or rel.name == "tracked-files.txt":
            continue
        data = read_bytes_strict(rel)
        text = decode_utf8_strict(data)
        for needle in needles:
            if needle and needle in text:
                fail("private needle detected")


def write_receipt_if_missing(root: Path) -> None:
    receipt = root / "release-receipt.json"
    if receipt.exists():
        return
    payload = {
        "status": "checked",
        "tracked_count": sum(1 for _ in (root / "tracked-files.txt").read_text().splitlines() if _.strip()),
    }
    receipt.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--structural-only", action="store_true")
    parser.add_argument("--private-denylist")
    parser.add_argument("output_dir")
    args = parser.parse_args()

    root = Path(args.output_dir).resolve()
    if not root.is_dir():
        fail("output dir must exist for checker")

    tracked = check_paths(root)
    scan_content(root, tracked)

    if args.private_denylist:
        scan_private_needles(root, Path(args.private_denylist).resolve())

    if args.structural_only or args.private_denylist:
        write_receipt_if_missing(root)

    print("check_release: ok")


if __name__ == "__main__":
    main()
