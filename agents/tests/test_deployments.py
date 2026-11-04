"""The address manifest only restates addresses already named in the files it cites."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "deployments" / "robinhood-chain.json"


def test_every_address_appears_in_a_cited_file():
    data = json.loads(MANIFEST.read_text())
    missing = []
    for entry in data["contracts"] + data["referenced"]:
        address = entry["address"]
        docs = entry.get("documentedIn") or []
        if not docs:
            missing.append(f"{entry['name']} has no documentedIn")
            continue
        blob = "\n".join((ROOT / path).read_text(encoding="utf-8", errors="ignore") for path in docs)
        if address.lower() not in blob.lower():
            missing.append(f"{entry['name']} {address} not in {docs}")
    assert not missing, missing
