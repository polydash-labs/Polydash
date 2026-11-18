'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTreasuryTx } from '@/lib/hooks/use-treasury';
import { fmtAmount, isAddr, type Addr } from '@/lib/treasury';
import { inputCls } from '@/components/treasury/rules-form';

/** Holder claim for one airdrop round: load the proof from the server (if the creator uploaded the tree) or paste the creator's proof file. */
export function AirdropClaim({ token, vault, round, decimals, symbol }: { token: string; vault: Addr; round: number; decimals: number; symbol: string }) {
  const { address } = useAccount();
  const { send, pending, lastError } = useTreasuryTx();
  const [account, setAccount] = useState('');
  const [proofText, setProofText] = useState('');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const acct = (account.trim() || address || '').toLowerCase();

  const load = async () => {
    setMsg(null);
    if (!isAddr(acct)) return setMsg('Enter an address or connect a wallet.');
    try {
      const r = await fetch(`/api/treasury/${token}/proof?round=${round}&account=${acct}`);
      const j = await r.json();
      if (!r.ok) {
        setMsg(j?.error === 'not_in_round' ? 'This address is not in this round.' : 'No proof on file for this round. Use the proof file from the creator.');
        return;
      }
      setAmount(String(j.amount));
      setProofText(JSON.stringify(j.proof));
    } catch (e) {
      console.error('proof load failed', e);
      setMsg('Could not load the proof. Please try again.');
    }
  };

  const parse = (): { amount: bigint; proof: `0x${string}`[] } | null => {
    try {
      const j = JSON.parse(proofText);
      const proof = (Array.isArray(j) ? j : j.proof) as `0x${string}`[];
      const amt = BigInt(Array.isArray(j) ? amount : (j.amount ?? amount));
      if (!Array.isArray(proof) || proof.some((p) => !/^0x[0-9a-fA-F]{64}$/.test(p))) return null;
      return { amount: amt, proof };
    } catch {
      return null;
    }
  };

  const claim = () => {
    setMsg(null);
    const p = parse();
    if (!isAddr(acct)) return setMsg('Enter an address or connect a wallet.');
    if (!p) return setMsg('Paste a valid proof: {"amount": "...", "proof": ["0x..."]} or a proof array with the amount (in base units).');
    send({ key: `claim-${round}`, address: vault, abi: 'vault', functionName: 'claim', args: [BigInt(round), acct, p.amount, p.proof], success: 'Airdrop claimed' });
  };

  const parsed = parse();
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-white/[0.03] p-3">
      <input className={inputCls} placeholder={address ? `Account (default: your wallet)` : 'Account address'} value={account} onChange={(e) => setAccount(e.target.value)} />
      <textarea className={`${inputCls} min-h-[70px] font-mono text-[11px]`} placeholder='Proof file from the creator, e.g. {"amount":"1000000000000000000","proof":["0x..."]}' value={proofText} onChange={(e) => setProofText(e.target.value)} />
      <input className={inputCls} placeholder="Amount in base units (only if the proof file has no amount)" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {parsed && <p className="text-[11px] text-white/55">Claim amount: {fmtAmount(parsed.amount, decimals)} {symbol}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="rounded-full" onClick={load}>Load my proof</Button>
        <Button size="sm" className="rounded-full" onClick={claim} disabled={!!pending}>
          {pending === `claim-${round}` && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Claim
        </Button>
      </div>
      {(msg || lastError) && <p className="text-[11px] text-amber-200">{msg || lastError}</p>}
    </div>
  );
}
