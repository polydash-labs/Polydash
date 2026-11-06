# Risk

Tokens launched on Polypad are created by their users, not by Polypad. The factory will deploy a token for any caller who pays the gas and passes `createLaunch`. A listing on the site means the factory emitted the launch. It does not mean Polypad reviewed the creator.

The contracts in this repository are unaudited. An outside review is planned. Verification on Sourcify shows that the published source matches the deployed bytecode where the deployment table says so. It is not a review of behaviour.

Security-scanned with Bevor. Not a formal audit. Scans are not audits. Not financial advice.

Automated checks in CI, including Slither, are not a review. A green run does not remove risk. Using these contracts can result in loss of funds.

## Labels

The Agent-launched badge means the token's social links include the documented mark. It does not mean the agent, the operator, or the token was reviewed.

The Build link is a GitHub URL the creator stored. Polypad does not check who controls that repository.

The Holder Protections label on a vesting vault means the cliff is at least 30 days and the duration is at least 180 days. It does not mean a price will hold, and a launch with no vault has no such label. Creator bonds slash only the posted ETH, and only when the registered wallets miss the floor. See [HOLDER_PROTECTIONS.md](HOLDER_PROTECTIONS.md).

## Fees

Trades pay a 0.2% platform fee and the creator fee chosen at launch (0% to 5% on the current factory). Both are taken in ETH. They are fees for the mechanism, not a forecast.

## Reporting

Report a vulnerability to [jon@dasheco.xyz](mailto:jon@dasheco.xyz) with the subject "Security report", or open a private GitHub security advisory. Do not file a public issue for a vulnerability. Test only on a local fork. Staking bounty terms are in [SECURITY.md](../SECURITY.md).
