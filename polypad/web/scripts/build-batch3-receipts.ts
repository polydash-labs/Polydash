// One-off builder for the batch-3 allowlist receipts (proposals 18–23).
// Reads every fact on-chain from the public RPC and writes the six receipt
// JSONs in the same shape as allowlist-executed-17-0x0741a46d.json (FRONG).
// No key, no spending, no writes on-chain — read-only.
//
//   npx tsx scripts/build-batch3-receipts.ts
import { writeFileSync } from 'node:fs';
import { createPublicClient, decodeEventLog, http, parseAbi } from 'viem';
import {
  EXPLORER_URL,
  FUND_ALLOWLIST_ADDRESS,
  ROBINHOOD_RPC_URL,
  fundAllowlistVerifierAbi,
  receiptEventsAbi,
} from '../lib/receipts/receipts-abi';

const client = createPublicClient({ transport: http(ROBINHOOD_RPC_URL) });

const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

const EXECUTOR = '0x3e298c64b4073ccffd9df671ebaedb886dcb9270' as const;

interface ProposalInput {
  id: number;
  symbol: string;
  target: `0x${string}`;
  feed: `0x${string}`;
  executeTx: `0x${string}`;
  proposeTx: `0x${string}`;
}

// Targets/feeds from the approved batch-3 plan; execute tx hashes from the
// Nov 21 ~16:55 PST executes; propose tx hashes from the forge broadcast
// file broadcast/DeployAllowlistBatch3.s.sol/4663/run-latest.json (all mined,
// status 1).
const PROPOSALS: ProposalInput[] = [
  { id: 18, symbol: 'AI', target: '0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18', feed: '0xA1C99B529b1031375645d0C59e1BC772a1729649', executeTx: '0x188b45e4d0c6b0ccc37b230892e9b3b7e253ceae5cc17bfba6385bd7e2be0f44', proposeTx: '0x2fb23a41d0168be6691d7bff34c1500b3eed6812d50f84a862f8799f99bd0180' },
  { id: 19, symbol: 'INDEX', target: '0x56910D4409F3a0C78C64DD8D0545FF0705389870', feed: '0xD95ca34c45928E17c6aC25ee2Ed3a282677ED268', executeTx: '0xe3b9ad7f5a31c23307f8abcc46d55495d6917001a163b92ff1756ecbd07bd1a8', proposeTx: '0x2550668456d6d365f5356a6476afad4c8210198dfc091d9bc56bae9bffa9d63c' },
  { id: 20, symbol: 'ROBINCAT', target: '0xded852De9fe9bA9b6f27f39e8e81CF851A5C79cc', feed: '0x5f10a3C70c2c772dDe72B221c513Fb186B8d7CA0', executeTx: '0x9ec66600152747dc9466226078ae3e68a6f9891661fae38724274a499b5bca8a', proposeTx: '0xe750ab39662b416e9ad5b1cedcb97482707094ef1793962ba4cd9259572b5d53' },
  { id: 21, symbol: 'UP', target: '0x57C0E45cB534413D1C20A4240955d6bB250BB4F1', feed: '0x7Fc62994609b78B0aC77df20Bf70cAF0e7d57257', executeTx: '0xd53466d3b2bde9bd745ea9f7fc1609ff54160570b401197430b40c5f7f9f8377', proposeTx: '0x987583d2dc73980eaa27201e83fef0371cf0a76ee030c49421fdd4c343de7339' },
  { id: 22, symbol: 'OAK', target: '0x6511c233790Ec10f7d673c64DC82C3F941D57828', feed: '0xA7ca134be22091d2d26a04D78CE6075Bb00Dac0A', executeTx: '0x550bb21d296d6e7e86cf0923e41c84771eabb11bd58615079ca88a9cdbdfaf0e', proposeTx: '0x7ac3fd74d9e62199a2ceef27090af35c183efc86555145fe120b3c68b86cb093' },
  { id: 23, symbol: 'HEY', target: '0xB33eb16782776b4D738c0Fd643577cb0284Db610', feed: '0xAC226fAb95e21e048a947B27b3d26c843C27Ec71', executeTx: '0x8f5bf4af71611c403b8ea6c2c06c23022d1e596835acace38c42269fda171f27', proposeTx: '0x7212f69a9cd72ee816fbd00af7005cf11b29d5176cf808dda2796e562d6d8ab2' },
];

const DISCLAIMER =
  'This receipt records what happened on-chain. It is not a guarantee, reimbursement, or insurance promise.';

async function buildOne(p: ProposalInput, owner: string, delay: bigint) {
  const [proposal, execTx, execReceipt, propTx, propReceipt, feed, name, symbol] =
    await Promise.all([
      client.readContract({
        address: FUND_ALLOWLIST_ADDRESS,
        abi: fundAllowlistVerifierAbi,
        functionName: 'proposals',
        args: [BigInt(p.id)],
      }),
      client.getTransaction({ hash: p.executeTx }),
      client.getTransactionReceipt({ hash: p.executeTx }),
      client.getTransaction({ hash: p.proposeTx }),
      client.getTransactionReceipt({ hash: p.proposeTx }),
      client.readContract({
        address: FUND_ALLOWLIST_ADDRESS,
        abi: fundAllowlistVerifierAbi,
        functionName: 'feedOf',
        args: [p.target],
      }),
      client.readContract({ address: p.target, abi: erc20Abi, functionName: 'name' }),
      client.readContract({ address: p.target, abi: erc20Abi, functionName: 'symbol' }),
    ]);
  const [execBlock, propBlock] = await Promise.all([
    client.getBlock({ blockNumber: execReceipt.blockNumber }),
    client.getBlock({ blockNumber: propReceipt.blockNumber }),
  ]);

  // Sanity: the data we were handed must match the chain, or stop loudly.
  if (execTx.from.toLowerCase() !== EXECUTOR) throw new Error(`#${p.id}: executor mismatch ${execTx.from}`);
  if (execReceipt.status !== 'success') throw new Error(`#${p.id}: execute tx not success`);
  if (propTx.from.toLowerCase() !== owner.toLowerCase()) throw new Error(`#${p.id}: proposer is not the owner`);
  if (proposal[0].toLowerCase() !== p.target.toLowerCase()) throw new Error(`#${p.id}: proposal target mismatch`);
  if (proposal[6].toLowerCase() !== p.feed.toLowerCase()) throw new Error(`#${p.id}: proposal feed mismatch`);
  if (!proposal[4] || proposal[5]) throw new Error(`#${p.id}: proposal not executed / canceled`);
  if (symbol.toLowerCase() !== p.symbol.toLowerCase()) throw new Error(`#${p.id}: symbol mismatch ${symbol} != ${p.symbol}`);
  // Note: assetSymbol below is the on-chain symbol() (e.g. "Index" for #19),
  // not the plan's uppercase ticker — the receipt records what is on-chain.

  const proposedAt = propBlock.timestamp;
  const readyAt = proposal[3];
  const executedAt = execBlock.timestamp;
  const waitElapsed = executedAt - readyAt;
  if (proposedAt + delay !== readyAt) throw new Error(`#${p.id}: readyAt != proposedAt + delay`);
  if (executedAt < readyAt) throw new Error(`#${p.id}: executed before readyAt`);

  // Event names in actual log order.
  const events: string[] = [];
  for (const log of execReceipt.logs) {
    try {
      const d = decodeEventLog({ abi: receiptEventsAbi, data: log.data, topics: log.topics });
      events.push(d.eventName);
    } catch {
      // Not a receipt event; ignore.
    }
  }

  const receipt = {
    receiptFormat: 'polypad.agent-receipt/1',
    receiptId: `allowlist-executed-${p.id}-block-${execReceipt.blockNumber}`,
    chain: { id: 4663, name: 'Robinhood Chain' },
    action: {
      type: 'allowlist-executed',
      description: `Allowlist proposal ${p.id} executed: ${p.symbol} enabled for Tokenized Funds.`,
    },
    identity: {
      executor: EXECUTOR,
      executorNote:
        'FundAllowlist.execute is permissionless once the timelock has passed; the executor is the transaction sender. No registered-agent identity is claimed for this address.',
    },
    authority: {
      rule: 'FundAllowlist.execute may be called by any address once the proposal readyAt has passed and the proposal is neither executed nor canceled. There is no executor allowlist.',
      contract: FUND_ALLOWLIST_ADDRESS,
      source: 'FundAllowlist.execute(uint256) — no access control on the caller',
    },
    approval: {
      rule: 'Only the contract owner may propose (FundAllowlist.proposeAsset is onlyOwner). A proposal waits the full delay before it can execute.',
      proposalId: p.id,
      target: p.target,
      assetSymbol: symbol,
      assetName: name,
      feed: p.feed,
      maxStaleSeconds: proposal[7].toString(),
      minPriceX18: proposal[8].toString(),
      maxPriceX18: proposal[9].toString(),
      proposedBy: propTx.from,
      ownerAtProposal: owner,
      proposeTransactionHash: p.proposeTx,
      proposedAt: proposedAt.toString(),
      proposedAtIso: new Date(Number(proposedAt) * 1000).toISOString(),
      readyAt: readyAt.toString(),
      readyAtIso: new Date(Number(readyAt) * 1000).toISOString(),
      delaySeconds: delay.toString(),
      executedAt: executedAt.toString(),
      executedAtIso: new Date(Number(executedAt) * 1000).toISOString(),
      waitElapsedSeconds: waitElapsed.toString(),
      source: 'FundAllowlist.proposals(id) + FundAllowlist.owner() + FundAllowlist.delay()',
    },
    settlement: {
      transactionHash: p.executeTx,
      blockNumber: execReceipt.blockNumber.toString(),
      blockTimestamp: executedAt.toString(),
      blockTimestampIso: new Date(Number(executedAt) * 1000).toISOString(),
      from: execTx.from,
      to: (execTx.to as string).toLowerCase(),
      status: 1,
      executed: true,
      canceled: false,
      assetAllowed: true,
      feedStored: feed[0],
      events,
      explorerUrl: `${EXPLORER_URL}/tx/${p.executeTx}`,
    },
    evidence: {
      allowlistUrl: `${EXPLORER_URL}/address/${FUND_ALLOWLIST_ADDRESS}`,
      assetUrl: `${EXPLORER_URL}/address/${p.target}`,
      feedUrl: `${EXPLORER_URL}/address/${p.feed}`,
      proposeTxUrl: `${EXPLORER_URL}/tx/${p.proposeTx}`,
      executorUrl: `${EXPLORER_URL}/address/${EXECUTOR}`,
    },
    disclaimer: DISCLAIMER,
  };

  const file = `allowlist-executed-${p.id}-${p.executeTx.slice(2, 10)}.json`;
  writeFileSync(new URL(`../public/receipts/${file}`, import.meta.url), JSON.stringify(receipt, null, 2) + '\n');
  console.log(
    `#${p.id} ${p.symbol}: block ${execReceipt.blockNumber}, proposedAt ${receipt.approval.proposedAtIso}, readyAt ${receipt.approval.readyAtIso}, executedAt ${receipt.approval.executedAtIso}, wait ${waitElapsed}s, events [${events.join(', ')}] -> ${file}`,
  );
  return file;
}

async function main() {
  const [owner, delay] = await Promise.all([
    client.readContract({ address: FUND_ALLOWLIST_ADDRESS, abi: fundAllowlistVerifierAbi, functionName: 'owner' }),
    client.readContract({ address: FUND_ALLOWLIST_ADDRESS, abi: fundAllowlistVerifierAbi, functionName: 'delay' }),
  ]);
  console.log(`owner ${owner}, delay ${delay}s`);
  const files: string[] = [];
  for (const p of PROPOSALS) {
    files.push(await buildOne(p, owner, delay));
  }
  console.log('\nWrote:', files.join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
