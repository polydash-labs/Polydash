// Agent Wallets — contract ABIs (Phase 1).
//
// RECONCILED Nov 20, 2026 against the real contracts in
// ~/workspace/polydash-agent-wallets (branch agent-wallets, commit 20ab15f):
// PolypadSessionKeyModule + PolypadWalletFactory, solc 0.8.24, optimizer 200,
// via_ir, cancun. These ABIs are copied verbatim from the forge build output
// (abi/*.json in that worktree) — do not hand-edit; regenerate with
// /tmp/gen_agent_wallet_abi.py if the contracts change.
//
// Key facts the UI relies on (see src/agent-wallet/README.md in the worktree):
// - Caps are RAW TOKEN UNITS, not USD. USDG has 6 decimals. Presets set USDG
//   caps only (Small 100_000/1_000_000/7_000_000, Medium 1M/10M/70M,
//   Large 10M/100M/700M); ETH caps are 0 under presets.
// - Policy is a struct: KeyPolicy{key, expiry, startHour, endHour, exists};
//   caps live per token (getTokenCaps / setTokenCaps), spent per token
//   (getSpent). There is NO flat keyPolicy tuple and NO agentKeyOf().
// - Module admin fns take `safe` as the FIRST arg and are Safe-only.
// - `approve` counts as spent immediately; spender must be allowlisted.
// - Empty allowlist = NOTHING allowed (not "any target").
// - SafeProxyFactory v1.4.1 checksum: 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
//   (the old ...C4F9c8A4f820ec67 casing is wrong — viem rejects it).
// - Approved-hash signatures use v == 1 (factory internal flow, not the UI).
//
// Safe itself is audited code (v1.3.0 singleton on Robinhood Chain); the new
// module + factory are NOT audited yet (Slither only). The UI never claims
// otherwise.

export const AgentWalletFactoryABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_singleton",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_proxyFactory",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_module",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "PRESET_LARGE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PRESET_MEDIUM",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PRESET_SMALL",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SESSION_EXPIRY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "USDG",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createWallet",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "backupKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "agentKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "policy",
        "type": "tuple",
        "internalType": "struct PolypadWalletFactory.PolicyInput",
        "components": [
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "startHour",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "endHour",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "tokens",
            "type": "address[]",
            "internalType": "address[]"
          },
          {
            "name": "caps",
            "type": "tuple[]",
            "internalType": "struct PolypadSessionKeyModule.TokenCaps[]",
            "components": [
              {
                "name": "perPayment",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "daily",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "weekly",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "allowedTargets",
            "type": "address[]",
            "internalType": "address[]"
          }
        ]
      },
      {
        "name": "saltNonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createWalletWithPreset",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "backupKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "agentKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "preset",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "allowedTargets",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "saltNonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "module",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract PolypadSessionKeyModule"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "predictWalletAddress",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PolypadWalletFactory.PolicyInput",
        "components": [
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "startHour",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "endHour",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "tokens",
            "type": "address[]",
            "internalType": "address[]"
          },
          {
            "name": "caps",
            "type": "tuple[]",
            "internalType": "struct PolypadSessionKeyModule.TokenCaps[]",
            "components": [
              {
                "name": "perPayment",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "daily",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "weekly",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "allowedTargets",
            "type": "address[]",
            "internalType": "address[]"
          }
        ]
      },
      {
        "name": "saltNonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "predicted",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "presetCaps",
    "inputs": [
      {
        "name": "preset",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PolypadSessionKeyModule.TokenCaps",
        "components": [
          {
            "name": "perPayment",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "daily",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "weekly",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "presetPolicy",
    "inputs": [
      {
        "name": "preset",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "allowedTargets",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "outputs": [
      {
        "name": "policy",
        "type": "tuple",
        "internalType": "struct PolypadWalletFactory.PolicyInput",
        "components": [
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "startHour",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "endHour",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "tokens",
            "type": "address[]",
            "internalType": "address[]"
          },
          {
            "name": "caps",
            "type": "tuple[]",
            "internalType": "struct PolypadSessionKeyModule.TokenCaps[]",
            "components": [
              {
                "name": "perPayment",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "daily",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "weekly",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "allowedTargets",
            "type": "address[]",
            "internalType": "address[]"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proxyFactory",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ISafeProxyFactoryForFactory"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "singleton",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "WalletCreated",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "agentKey",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "InvalidPolicy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPreset",
    "inputs": []
  },
  {
    "type": "error",
    "name": "KeysMustDiffer",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeTxFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const;

/** The session-key module attached to each agent wallet. */
export const AgentWalletModuleABI = [
  {
    "type": "function",
    "name": "ROTATION_TIMELOCK",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "allowedTargets",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "backupKey",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelOwnerRotation",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "completeOwnerRotation",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "execute",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "operation",
        "type": "uint8",
        "internalType": "enum EnumOperation"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "frozen",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPendingRotation",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PolypadSessionKeyModule.PendingRotation",
        "components": [
          {
            "name": "oldOwner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "newOwner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "executeAfter",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "exists",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPolicy",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PolypadSessionKeyModule.KeyPolicy",
        "components": [
          {
            "name": "key",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "startHour",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "endHour",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "exists",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPolicyTokens",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getSpent",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "dailySpent",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "weeklySpent",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "day",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "week",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getTokenCaps",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PolypadSessionKeyModule.TokenCaps",
        "components": [
          {
            "name": "perPayment",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "daily",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "weekly",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "initiateOwnerRotation",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "isKeyActive",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingRotations",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "oldOwner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "executeAfter",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "exists",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "policies",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "startHour",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "endHour",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "exists",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "policyTokens",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "revokeKey",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rotateKey",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "oldKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newKey",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAllowedTarget",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setBackupKey",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newBackupKey",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setFrozen",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "freeze",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setKeyPolicy",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "startHour",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "endHour",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTokenCaps",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "caps",
        "type": "tuple",
        "internalType": "struct PolypadSessionKeyModule.TokenCaps",
        "components": [
          {
            "name": "perPayment",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "daily",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "weekly",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "spentDaily",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "spentWeekly",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tokenCaps",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "perPayment",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "daily",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "weekly",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unfreeze",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AllowedTargetSet",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "target",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BackupKeySet",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "backupKey",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Executed",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "target",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Frozen",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "KeyPolicySet",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "startHour",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "endHour",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "KeyRevoked",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "KeyRotated",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldKey",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newKey",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RotationCancelled",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RotationCompleted",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RotationInitiated",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "executeAfter",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TokenCapsSet",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "perPayment",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "daily",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "weekly",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unfrozen",
    "inputs": [
      {
        "name": "safe",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "CapExceeded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DelegateCallForbidden",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidNewOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidWindow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "KeyAlreadyExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "KeyExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ModuleCallFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPolicy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoRotationPending",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotBackupKey",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotSafe",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotSingleOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OutsideActiveHours",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RotationAlreadyPending",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RotationTooEarly",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TargetForbidden",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TargetNotAllowed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WalletFrozen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroKey",
    "inputs": []
  }
] as const;

/** Minimal Safe (v1.3.0) surface the UI needs: owner-signed module calls + reads. */
export const SafeABI = [
  {
    type: 'function', name: 'execTransaction', stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    type: 'function', name: 'getTransactionHash', stateMutability: 'view',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: '_nonce', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'getOwners', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address[]' }] },
  { type: 'function', name: 'getThreshold', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'isModuleEnabled', stateMutability: 'view', inputs: [{ name: 'module', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  {
    type: 'event', name: 'ExecutionSuccess',
    inputs: [{ name: 'txHash', type: 'bytes32', indexed: true }, { name: 'payment', type: 'uint256' }],
  },
  {
    type: 'event', name: 'ExecutionFailure',
    inputs: [{ name: 'txHash', type: 'bytes32', indexed: true }, { name: 'payment', type: 'uint256' }],
  },
] as const;
