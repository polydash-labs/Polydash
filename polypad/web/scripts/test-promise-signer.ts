import { createPublicClient, getAddress, http, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PrismaClient } from '@prisma/client';
import { robinhoodChain } from '../lib/chain';
import { canonicalJson, endsAtFor, promiseTypedData, validateParams } from '../lib/promises/presets';

const prisma = new PrismaClient();
const client = createPublicClient({ chain: robinhoodChain, transport: http() });

(async () => {
  const row = await prisma.tokenCTO.findFirst({ where: { symbol: 'MOON' } });
  if (!row) throw new Error('MOON not found');
  console.log('launch', row.launchAddress);
  const creator = await client.readContract({ address: getAddress(row.launchAddress), abi: parseAbi(['function creator() view returns (address)']), functionName: 'creator' });
  console.log('on-chain creator', creator, 'db creator matches:', creator.toLowerCase() === row.creator);
  const acct = privateKeyToAccount(generatePrivateKey());
  const v = validateParams('no_sell', { days: 7, wallets: [] });
  if (!v.ok) throw new Error(v.error);
  const startsAt = Math.floor(Date.now() / 1000);
  const td = promiseTypedData({ launch: row.launchAddress, token: row.tokenAddress, kind: 'no_sell', params: canonicalJson(v.params), startsAt, endsAt: endsAtFor('no_sell', v.params, startsAt), nonce: 'promise:test', chainId: 4663 });
  const signature = await acct.signTypedData(td);
  const selfOk = await client.verifyTypedData({ address: acct.address, ...td, signature });
  const creatorOk = await client.verifyTypedData({ address: getAddress(creator), ...td, signature });
  console.log(selfOk ? 'PASS  signature valid for the random signer' : 'FAIL  self-verify');
  console.log(!creatorOk ? 'PASS  non-creator signature rejected against the on-chain creator' : 'FAIL  non-creator accepted');
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
