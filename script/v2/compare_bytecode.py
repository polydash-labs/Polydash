#!/usr/bin/env python3
"""Compare locally compiled V2 runtime bytecode against on-chain eth_getCode.

Masks immutable references (from the forge artifact) and CBOR metadata blobs
(a2 64 'ipfs' 58 22 <34 bytes> 64 'solc' 43 <3 bytes> 00 33), which depend on
source file paths, then requires an exact match of everything else.
Usage: forge build && python3 script/v2/compare_bytecode.py [RPC_URL]
"""
import json
import re
import sys
import urllib.request

RPC = sys.argv[1] if len(sys.argv) > 1 else "https://rpc.mainnet.chain.robinhood.com"
TARGETS = [
    ("PolydashStakingFactoryV2", "0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0"),
    ("PolydashStakingPoolV2", "0xB2BBc1752FAa5BCfC67571819af30CE2AaF58518"),
    ("PolydashStakingPoolV2", "0x0F50043E172B8652bb786C4F14f30c415E5760AB"),
]
CBOR = re.compile(r"a264697066735822[0-9a-f]{68}64736f6c6343[0-9a-f]{6}0033")


def get_code(addr):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_getCode", "params": [addr, "latest"]}).encode()
    req = urllib.request.Request(RPC, body, {"Content-Type": "application/json", "User-Agent": "polydash-ci/1.0"})
    return json.load(urllib.request.urlopen(req, timeout=30))["result"][2:].lower()


def mask(code, imm):
    b = bytearray.fromhex(code)
    for refs in imm.values():
        for r in refs:
            b[r["start"] : r["start"] + r["length"]] = b"\0" * r["length"]
    return CBOR.sub(lambda m: "0" * len(m.group()), b.hex())


ok = True
for name, addr in TARGETS:
    art = json.load(open(f"out/{name}.sol/{name}.json"))
    local = art["deployedBytecode"]["object"][2:].lower()
    imm = art["deployedBytecode"].get("immutableReferences", {})
    chain = get_code(addr)
    same_len = len(local) == len(chain)
    match = same_len and mask(local, imm) == mask(chain, imm)
    raw = local == chain
    ok &= match
    print(f"{name} {addr}: bytes={len(chain)//2} lengthMatch={same_len} "
          f"match(ignoring metadata+immutables)={match} rawIdentical={raw}")
sys.exit(0 if ok else 1)
