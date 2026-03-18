from __future__ import annotations

import json
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    known_cases_path = root / "data" / "known_cases.json"
    cases = json.loads(known_cases_path.read_text())
    print(json.dumps({"known_cases_loaded": len(cases), "file": str(known_cases_path)}, indent=2))


if __name__ == "__main__":
    main()
