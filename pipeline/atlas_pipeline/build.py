"""Top-level build command.

Usage:
    python -m atlas_pipeline.build           # validate + rebuild derived artifacts
    python -m atlas_pipeline.build --strict  # exit non-zero on any schema error
"""
from __future__ import annotations

import argparse
import sys

from .indexers import write_artifacts
from .paths import COMPANIES_DIR, ETFS_DIR
from .validate import validate_file


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build Atlas data artifacts")
    parser.add_argument("--strict", action="store_true",
                        help="Fail (exit 1) if any source file fails schema validation")
    args = parser.parse_args(argv)

    errors: list[str] = []

    for path in sorted(COMPANIES_DIR.glob("*.json")):
        for err in validate_file(path, "company.schema.json"):
            errors.append(f"[company] {path.name}: {err}")

    if ETFS_DIR.exists():
        for path in sorted(ETFS_DIR.glob("*.json")):
            for err in validate_file(path, "etf.schema.json"):
                errors.append(f"[etf] {path.name}: {err}")

    if errors:
        print(f"⚠️  {len(errors)} schema issue(s):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        if args.strict:
            return 1
    else:
        print("✅ All source files valid.")

    write_artifacts()
    print("✅ Wrote data/search-index.json and data/screener.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
