## Summary

## Changes

## Checklist
- [ ] `forge fmt --check`, `forge build`, and `forge test` pass when Solidity or Foundry config changed
- [ ] `ruff check agents script` and `pytest` pass when agent code changed
- [ ] Tests added or updated for new behaviour
- [ ] No secrets, keys, or `.env` files committed (`python3 script/scan_secrets.py`)
- [ ] Docs and CHANGELOG updated if behaviour or addresses changed
- [ ] Does not modify deployed `.sol` sources (or explains why)
- [ ] Docs do not call contracts audited, safe, or guaranteed
