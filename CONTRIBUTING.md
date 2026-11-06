# Contributing

Thanks for helping improve Polydash. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

1. Fork the repository and branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. `git submodule update --init --recursive`
3. Install [Foundry](https://book.getfoundry.sh/).
4. For agent work, use Python 3.10+ and `pip install -r agents/poly-agent/requirements.txt -r agents/polycto/requirements.txt ruff pytest`.

## Checks

```bash
forge fmt --check
forge build
forge test
ruff check agents script
pytest
python3 script/scan_secrets.py
```

Polypad web tests, from `polypad/web`: `corepack enable && corepack prepare yarn@4.9.2 --activate && yarn test` after `yarn install --immutable`.

`FOUNDRY_PROFILE=ci` is what GitHub Actions uses for Foundry. Fork tests need `FORK_RPC` and are optional locally.

## Pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`).
- Fill in the pull request template. CI must be green.
- Update [CHANGELOG.md](CHANGELOG.md) when behaviour or deployed addresses change.
- Add or update tests for new behaviour.
- Docs must not call contracts audited, safe, or guaranteed. Say they are unaudited, and that an outside review is planned. Say "fees", not "revenue". Say "integrated with", not "partnered". Write "Robinhood Chain" in full.

## Deployed source

Do not edit deployed Solidity to reformat it or to "clean up" comments. `forge fmt` ignores `src/**/*.sol` because those files are kept identical to the verified sources. New behaviour belongs in a new module or version. The same restraint applies to `polypad/contracts/src/`.

## Secrets

Never commit `.env`, private keys, seed phrases, or keystores. Copy the relevant `.env.example` and keep the real file local. `script/scan_secrets.py` runs in CI.

## Security issues

Follow [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.
