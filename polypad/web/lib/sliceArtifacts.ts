// Staker airdrop slice - generated artifacts (not audited). Do not edit by hand.
// Deploy order from admin wallet 0x89df38Df79C0a7E96214c596ceF5773d2ac353F1: nonce 51 distributor, nonce 52 escrow.
export const SLICE_ADMIN_DEPLOYER = "0x89df38Df79C0a7E96214c596ceF5773d2ac353F1" as const;
export const SLICE_DISTRIBUTOR_EXPECTED_ADDRESS = "0x5ca4B6bc4e40C6E7120b8d28467cc6b00410c0E0" as const; // nonce 51
export const SLICE_ESCROW_EXPECTED_ADDRESS = "0xa43A2F3512133F2559Cd6199AF628bebE2417556" as const; // nonce 52
export const SLICE_DISTRIBUTOR_ABI = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "_escrow",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "_rootPoster",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "_guardian",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "_rewardsPool",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "_epochGenesis",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "EPOCH_LENGTH",
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
  "name": "ROOT_DELAY",
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
  "name": "activateRoot",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "claimMany",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "tokens",
    "type": "address[]",
    "internalType": "address[]"
   },
   {
    "name": "cumulativeAmounts",
    "type": "uint256[]",
    "internalType": "uint256[]"
   },
   {
    "name": "proofs",
    "type": "bytes32[][]",
    "internalType": "bytes32[][]"
   }
  ],
  "outputs": [
   {
    "name": "paidCount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "claimable",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "cumulativeAmount",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "proof",
    "type": "bytes32[]",
    "internalType": "bytes32[]"
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
  "name": "claimed",
  "inputs": [
   {
    "name": "account",
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
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "credit",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "credited",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
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
  "name": "currentEpoch",
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
  "name": "epochEnd",
  "inputs": [
   {
    "name": "epoch",
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
  "name": "epochGenesis",
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
  "name": "escrow",
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
  "name": "guardian",
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
  "name": "pendingAt",
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
  "name": "pendingDataHash",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "pendingEpoch",
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
  "name": "pendingRoot",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "proposeRoot",
  "inputs": [
   {
    "name": "newRoot",
    "type": "bytes32",
    "internalType": "bytes32"
   },
   {
    "name": "epoch",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "dataHash",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "rewardsPool",
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
  "name": "root",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "rootDataHash",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "rootEpoch",
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
  "name": "rootPoster",
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
  "name": "totalClaimed",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
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
  "name": "vetoRoot",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "event",
  "name": "ClaimFailed",
  "inputs": [
   {
    "name": "account",
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
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Claimed",
  "inputs": [
   {
    "name": "account",
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
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "caller",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Credited",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "totalCredited",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RootActivated",
  "inputs": [
   {
    "name": "root",
    "type": "bytes32",
    "indexed": true,
    "internalType": "bytes32"
   },
   {
    "name": "epoch",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "dataHash",
    "type": "bytes32",
    "indexed": false,
    "internalType": "bytes32"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RootProposed",
  "inputs": [
   {
    "name": "root",
    "type": "bytes32",
    "indexed": true,
    "internalType": "bytes32"
   },
   {
    "name": "epoch",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "dataHash",
    "type": "bytes32",
    "indexed": false,
    "internalType": "bytes32"
   },
   {
    "name": "activatableAt",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RootVetoed",
  "inputs": [
   {
    "name": "root",
    "type": "bytes32",
    "indexed": true,
    "internalType": "bytes32"
   },
   {
    "name": "epoch",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "BadEpoch",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadProof",
  "inputs": []
 },
 {
  "type": "error",
  "name": "EpochNotOver",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ExceedsCredited",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LengthMismatch",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoPending",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotEscrow",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotGuardian",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotPoster",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PendingExists",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ReentrancyGuardReentrantCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TooEarly",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ZeroAddress",
  "inputs": []
 }
] as const;
export const SLICE_DISTRIBUTOR_BYTECODE = "0x6101203461015357601f610fcc38819003918201601f19168301916001600160401b038311848410176101575780849260a094604052833981010312610153576100488161016b565b906100556020820161016b565b6100616040830161016b565b9060806100706060850161016b565b93015160015f55936001600160a01b038116158015610142575b8015610131575b8015610120575b6101115760805260a05260c05260e052610100525f19600255604051610e4c908161018082396080518181816102040152610307015260a0518181816108de0152610a25015260c0518181816107e901526109e1015260e05181610b0d015261010051818181610ad801528181610bb50152610c2b0152f35b63d92e233d60e01b5f5260045ffd5b506001600160a01b03841615610098565b506001600160a01b03831615610091565b506001600160a01b0382161561008a565b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036101535756fe6080806040526004361015610012575f80fd5b5f3560e01c9081630359fea914610afb5750806304079f8114610ac15780630c9cbf0e14610a7157806332b49b4714610a545780633a7ad71e14610a10578063452a9320146109cc57806369e313f4146108c257806373e1f15a146108a5578063750588cf14610888578063766718081461086e5780637898651e146107d7578063930667d8146107ba578063979bc1d214610726578063a38ac9a3146103ab578063a922fef91461038e578063ac4746ab14610371578063c9cfea8814610354578063d9be1efe14610336578063e2fdcc17146102f2578063ebf0c717146102d5578063ef5d9ae81461029d578063ef6506db146101e5578063f552501a146101c8578063fde181a91461016b5763fdf60ec71461012f575f80fd5b34610167576020366003190112610167576001600160a01b03610150610b3c565b165f526008602052602060405f2054604051908152f35b5f80fd5b3461016757608036600319011261016757610184610b3c565b61018c610b52565b906064359067ffffffffffffffff8211610167576020926101b46101c0933690600401610b68565b92909160443591610c52565b604051908152f35b34610167575f366003190112610167576020600554604051908152f35b34610167576040366003190112610167576101fe610b3c565b602435907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330361028e5760407f796a6ec99f41042b589b3c8dfab9ec6ae027e9c6599a6a4e311aa00a19ebdb1f9160018060a01b031692835f52600860205261027481835f2054610b99565b845f52600860205280835f205582519182526020820152a2005b637e223fb160e11b5f5260045ffd5b34610167576020366003190112610167576001600160a01b036102be610b3c565b165f526009602052602060405f2054604051908152f35b34610167575f366003190112610167576020600154604051908152f35b34610167575f366003190112610167576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b346101675760203660031901126101675760206101c0600435610c03565b34610167575f366003190112610167576020600654604051908152f35b34610167575f36600319011261016757602060405162093a808152f35b34610167575f366003190112610167576020600354604051908152f35b34610167576080366003190112610167576103c4610b3c565b60243567ffffffffffffffff8111610167576103e4903690600401610b68565b9160443567ffffffffffffffff811161016757610405903690600401610b68565b939060643567ffffffffffffffff811161016757610427903690600401610b68565b929060025f54146107175760025f555f9682811480159061070d575b6106fe5785858589938b95600154915f985b808a1061046b5760208960015f55604051908152f35b909192939495969761047e8a838b610bf3565b35996001600160a01b038b168b036101675761049b818589610bf3565b35888210156106ea578160051b860135601e198736030181121561016757860167ffffffffffffffff813511610167576020810190803560051b3603821361016757886104f7928f858f916104ef92610cef565b923590610d46565b156106db5760018060a01b038a165f52600a60205260405f2060018060a01b038d165f5260205260405f2054808211156106cf57806105378e9284610ba6565b9260018060a01b0383165f5260096020526105568460405f2054610b99565b6001600160a01b039093165f9081526008602052604090205483116106c057838f8e906105bf9360018060a01b0383165f52600a60205260405f2060018060a01b0383165f5260205260405f205560018060a01b0381165f5260096020528560405f2055610d98565b156106385750505f198314610624576040805191825233602083015260019384019c6001600160a01b0390811692908c16917f0ffa55c11cec5055a4f567b0ff6e1e0eef2af17baafddd35f31ab4ed1afb754691a35b01989796959493929190610455565b634e487b7160e01b5f52601160045260245ffd5b826001959e9261066c928e888060a01b03165f52600a60205260405f20888060a01b0386165f5260205260405f2055610ba6565b848060a01b0382165f52600960205260405f2055604051918252838060a01b0316907ff4042d1e5bc08cb63e46ad28d52bc70c84feed1a1261809ad4a8628749faaac76020858060a01b038d1692a3610615565b63e87e855960e01b5f5260045ffd5b50506001919a50610615565b637ca55c7760e01b5f5260045ffd5b634e487b7160e01b5f52603260045260245ffd5b631fec674760e31b5f5260045ffd5b5082851415610443565b633ee5aeb560e01b5f5260045ffd5b34610167575f3660031901126101675760075480156107ab57421061079c576004548060015560055490816002557fd4b9409e7c6d7dfcebe77c4a35536e65a3c6cdb08823e65879d8d4966667637b602060065480600355604051908152a361079a5f6004555f6005555f6006555f600755565b005b63085de62560e01b5f5260045ffd5b63369d55ef60e21b5f5260045ffd5b34610167575f366003190112610167576020600754604051908152f35b34610167575f366003190112610167577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330361085f57600754156107ab57600454600554907f4dcb283be9850a129844799016c55c0aa0778c09b56f781c518eafeb02514bd65f80a361079a5f6004555f6005555f6006555f600755565b6377b6878160e11b5f5260045ffd5b34610167575f3660031901126101675760206101c0610bb3565b34610167575f366003190112610167576020600454604051908152f35b34610167575f366003190112610167576020604051620151808152f35b34610167576060366003190112610167576024356004356044357f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036109bd576007546109ae5761091c83610c03565b421061099f576002545f198114159081610994575b5061098557816004558260055580600655620151804201804211610624577f1e6d784a0643e7d7d172fed333d6bd32051b0eefdd3c409224ab17f4eb97738e918160409260075582519182526020820152a3005b630aa733db60e01b5f5260045ffd5b905083111584610931565b6361b708dd60e01b5f5260045ffd5b634b1a898d60e01b5f5260045ffd5b630edd024760e11b5f5260045ffd5b34610167575f366003190112610167576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610167575f366003190112610167576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610167575f366003190112610167576020600254604051908152f35b3461016757604036600319011261016757610a8a610b3c565b610a92610b52565b6001600160a01b039182165f908152600a60209081526040808320949093168252928352819020549051908152f35b34610167575f3660031901126101675760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610167575f366003190112610167577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b600435906001600160a01b038216820361016757565b602435906001600160a01b038216820361016757565b9181601f840112156101675782359167ffffffffffffffff8311610167576020808501948460051b01011161016757565b9190820180921161062457565b9190820391821161062457565b7f0000000000000000000000000000000000000000000000000000000000000000804210610bed57610be962093a809142610ba6565b0490565b505f1990565b91908110156106ea5760051b0190565b600181018091116106245762093a8081029080820462093a80149015171561062457610c4f907f0000000000000000000000000000000000000000000000000000000000000000610b99565b90565b919392610c6f919360015490610c69878787610cef565b92610d46565b15610cb25760018060a01b03165f52600a60205260405f209060018060a01b03165f5260205260405f20548082115f14610cac57610c4f91610ba6565b50505f90565b5050505f90565b90601f8019910116810190811067ffffffffffffffff821117610cdb57604052565b634e487b7160e01b5f52604160045260245ffd5b604080516001600160a01b03928316602082019081529290931690830152606080830193909352918152610d24608082610cb9565b5190206040516020810191825260208152610d40604082610cb9565b51902090565b9192915f915b808310610d5a575050501490565b909192610d68848385610bf3565b359081811015610d87575f52602052600160405f205b93019190610d4c565b905f52602052600160405f20610d7e565b919091803b15610cb2576020925f8093604051908682019363a9059cbb60e01b855260018060a01b03166024830152604482015260448152610ddb606482610cb9565b519262030d40f13d5f5182610def57505090565b81159250908215610dff57505090565b60201115915081610e0e575090565b60019150149056fea264697066735822122057afe306e5e8a6d858708f74047f906075bd758f8070f9db42f10ecbb65ea3fb64736f6c634300081a0033" as `0x${string}`;
// constructor(escrow, rootPoster, guardian, rewardsPool, epochGenesis)
export const SLICE_DISTRIBUTOR_ARGS = [
  "0xa43A2F3512133F2559Cd6199AF628bebE2417556", // escrow (expected, nonce 52)
  "0xd75492a45Ceed467d2147cBa74A9595b949E491E", // root poster = Polydash agent wallet (can only propose roots)
  "0x9a21c75aC263cC43125E70200636f6397f8776d0", // guardian = Polydash fees wallet (veto only)
  "0x608d106Bb58A804fcd45823e0C6087801dee2aCa", // POLYDASH Rewards Pool (stake source)
  1794096000n, // epoch 0 starts Sunday 2026-11-08 00:00 UTC (Sat Nov 7, 4:00 PM PT)
] as const;
export const SLICE_ESCROW_ABI = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "_factoryA",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "_factoryB",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "_distributor",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "BPS",
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
  "name": "MAX_DURATION",
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
  "name": "MAX_TOTAL_BPS",
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
  "name": "MIN_DURATION",
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
  "name": "MIN_SLICE_BPS",
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
  "name": "commitSlice",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "duration",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "committedBps",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
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
  "name": "committedOfToken",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
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
  "name": "distributor",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract ISliceDistributor"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "factoryA",
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
  "name": "factoryB",
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
  "name": "getSlice",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct SliceEscrow.Slice",
    "components": [
     {
      "name": "token",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "creator",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "amount",
      "type": "uint128",
      "internalType": "uint128"
     },
     {
      "name": "released",
      "type": "uint128",
      "internalType": "uint128"
     },
     {
      "name": "start",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "duration",
      "type": "uint64",
      "internalType": "uint64"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "launchOf",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "l",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "releasable",
  "inputs": [
   {
    "name": "id",
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
  "name": "release",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "amt",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "releaseMany",
  "inputs": [
   {
    "name": "ids",
    "type": "uint256[]",
    "internalType": "uint256[]"
   }
  ],
  "outputs": [
   {
    "name": "total",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "slicesLength",
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
  "name": "slicesOfToken",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint256[]",
    "internalType": "uint256[]"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "vested",
  "inputs": [
   {
    "name": "id",
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
  "type": "event",
  "name": "SliceCommitted",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "token",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "creator",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "bps",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "start",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "duration",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "SliceReleased",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "token",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "totalReleased",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "AddressEmptyCode",
  "inputs": [
   {
    "name": "target",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "AddressInsufficientBalance",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "BadAmount",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadDuration",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CapExceeded",
  "inputs": []
 },
 {
  "type": "error",
  "name": "FailedInnerCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "FeeOnTransfer",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotCreator",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotPolypadToken",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ReentrancyGuardReentrantCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SafeERC20FailedOperation",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "UnknownSlice",
  "inputs": []
 },
 {
  "type": "error",
  "name": "WrongDistributor",
  "inputs": []
 }
] as const;
export const SLICE_ESCROW_BYTECODE = "0x60e0806040523461013857606081611317803803809161001f8285610169565b83398101031261013857610032816101a0565b9061004b6040610044602084016101a0565b92016101a0565b60015f556001600160a01b038316158015610158575b801561014f575b6100f75760405163e2fdcc1760e01b81526001600160a01b03919091169290602081600481875afa908115610144575f91610106575b50306001600160a01b03909116036100f75760805260a05260c05260405161116290816101b5823960805181818160ff0152610bab015260a05181818161087a0152610bea015260c0518181816106ce0152610e6b0152f35b63cdc480d960e01b5f5260045ffd5b90506020813d60201161013c575b8161012160209383610169565b8101031261013857610132906101a0565b5f61009e565b5f80fd5b3d9150610114565b6040513d5f823e3d90fd5b50803b15610068565b506001600160a01b03821615610061565b601f909101601f19168101906001600160401b0382119082101761018c57604052565b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036101385756fe60806040526004361015610011575f80fd5b5f3560e01c8063029282d714610b595780630715139b14610abf57806307f26d31146109ff5780630f64572b146109e257806315885ae6146109c7578063249d39e9146109ab578063353c09701461098f57806337bdc99b1461095d5780634ea4fac6146108a95780635eb1c5711461086557806387d150e114610756578063968fb8ba14610738578063b1724b461461071a578063b6a6d177146106fd578063bfe10928146106b9578063e43a610d14610190578063e4bf01a81461016a578063f502e6b8146101325763fd691645146100ea575f80fd5b3461012e575f36600319011261012e576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5f80fd5b3461012e57602036600319011261012e576001600160a01b03610153610b8e565b165f526003602052602060405f2054604051908152f35b3461012e57602036600319011261012e576020610188600435610d46565b604051908152f35b3461012e57606036600319011261012e576101a9610b8e565b60243590604435906101b9610dd8565b6001600160a01b036101ca82610ba4565b1680156106aa576020600491604051928380926302d05d3f60e01b82525afa908115610549575f9161067b575b50336001600160a01b039091160361066c5762278d008210801561065f575b610650576040516318160ddd60e01b815292906001600160a01b0316602084600481845afa938415610549575f9461061c575b5081159283801561060c575b80156105df575b6105d057815f5260036020526102768360405f2054610c11565b612710810281810461271014821517156104ed576101f48702908782046101f414881517156104ed57116105c157825f52600360205260405f2055600154936040516102c181610c1e565b8381526020810133815260408201916001600160801b0387168352606081015f8152608082019367ffffffffffffffff4216855260a083019367ffffffffffffffff88168552600160401b8b101561059a5760018b016001556103238b610c7a565b9290926105ae57935182546001600160a01b03199081166001600160a01b03928316178455915160018401805490931691161790559151905160801b6001600160801b0319166001600160801b039190911617600282015567ffffffffffffffff906003019251166fffffffffffffffff00000000000000008354925160401b16916001600160801b03191617179055825f52600260205260405f208054600160401b81101561059a57600181018083558110156105865786915f5260205f2001556040516370a0823160e01b8152306004820152602081602481875afa908115610549575f91610554575b5061044a6040516323b872dd60e01b602082015233602482015230604482015286606482015260648152610444608482610c3a565b8561101b565b6040516370a0823160e01b815230600482015290602082602481885afa80156105495786925f91610510575b509061048191610c96565b03610501576127108402908482046127101417156104ed576020956104a591610c5c565b604051938452858401524260408401526060830152827fa0bcdf71e7bbb4a47cadf323a5ae78ba343e407b995caee99f072ddf47f14a1b60803394a460015f55604051908152f35b634e487b7160e01b5f52601160045260245ffd5b6330f32a4f60e11b5f5260045ffd5b919250506020813d602011610541575b8161052d60209383610c3a565b8101031261012e5751859190610481610476565b3d9150610520565b6040513d5f823e3d90fd5b90506020813d60201161057e575b8161056f60209383610c3a565b8101031261012e57518761040f565b3d9150610562565b634e487b7160e01b5f52603260045260245ffd5b634e487b7160e01b5f52604160045260245ffd5b634e487b7160e01b5f525f60045260245ffd5b63a4875a4960e01b5f5260045ffd5b63749b593960e01b5f5260045ffd5b506127108302838104612710148517156104ed576019860290868204601914871517156104ed571061025c565b506001600160801b038311610255565b9093506020813d602011610648575b8161063860209383610c3a565b8101031261012e57519284610249565b3d915061062b565b634d84c2e960e01b5f5260045ffd5b506301e133808211610216565b6393687c0b60e01b5f5260045ffd5b61069d915060203d6020116106a3575b6106958183610c3a565b810190610d27565b846101f7565b503d61068b565b631316959160e01b5f5260045ffd5b3461012e575f36600319011261012e576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461012e575f36600319011261012e57602060405162278d008152f35b3461012e575f36600319011261012e5760206040516301e133808152f35b3461012e57602036600319011261012e576020610188600435610ca3565b3461012e57602036600319011261012e576004355f60a060405161077981610c1e565b8281528260208201528260408201528260608201528260808201520152600154811015610856576107ab60c091610c7a565b5067ffffffffffffffff604051916107c283610c1e565b8160018060a01b03825416938481526001600160801b0360018060a01b03600185015416936020830194855281600282015491600360408601918385168352606087019460801c85520154968660a06080880197828b168952019860401c168852604051998a5260018060a01b0390511660208a0152511660408801525116606086015251166080840152511660a0820152f35b633c81d0ef60e21b5f5260045ffd5b3461012e575f36600319011261012e576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461012e57602036600319011261012e576001600160a01b036108ca610b8e565b165f52600260205260405f20604051806020835491828152019081935f5260205f20905f5b8181106109475750505081610905910382610c3a565b604051918291602083019060208452518091526040830191905f5b81811061092e575050500390f35b8251845285945060209384019390920191600101610920565b82548452602090930192600192830192016108ef565b3461012e57602036600319011261012e57610976610dd8565b6020610983600435610df6565b60015f55604051908152f35b3461012e575f36600319011261012e5760206040516101f48152f35b3461012e575f36600319011261012e5760206040516127108152f35b3461012e575f36600319011261012e57602060405160198152f35b3461012e575f36600319011261012e576020600154604051908152f35b3461012e57602036600319011261012e576001600160a01b03610a20610b8e565b6040516318160ddd60e01b81529116602082600481845afa918215610549575f92610a8b575b5081610a5957505060205f604051908152f35b5f52600360205260405f205461271081029080820461271014901517156104ed57602091610a8691610c5c565b610188565b9091506020813d602011610ab7575b81610aa760209383610c3a565b8101031261012e57519082610a46565b3d9150610a9a565b3461012e57602036600319011261012e5760043567ffffffffffffffff811161012e573660238201121561012e57806004013567ffffffffffffffff811161012e573660248260051b8401011161012e57610b18610dd8565b5f91825b82841015610b4a57610b42600191610b3c60248760051b86010135610df6565b90610c11565b930192610b1c565b60209060015f55604051908152f35b3461012e57602036600319011261012e576020610b7c610b77610b8e565b610ba4565b6040516001600160a01b039091168152f35b600435906001600160a01b038216820361012e57565b90610bcf827f0000000000000000000000000000000000000000000000000000000000000000610d74565b916001600160a01b03831615610be25750565b610c0e9192507f0000000000000000000000000000000000000000000000000000000000000000610d74565b90565b919082018092116104ed57565b60c0810190811067ffffffffffffffff82111761059a57604052565b90601f8019910116810190811067ffffffffffffffff82111761059a57604052565b8115610c66570490565b634e487b7160e01b5f52601260045260245ffd5b6001548110156105865760015f5260205f209060021b01905f90565b919082039182116104ed57565b610cac90610c7a565b5060038101549067ffffffffffffffff821680421115610d2057610cd967ffffffffffffffff9142610c96565b9260401c169081831015610d0d57600201546001600160801b03168281029281159184041417156104ed57610c0e91610c5c565b600201546001600160801b031692915050565b5050505f90565b9081602091031261012e57516001600160a01b038116810361012e5790565b60015481101561085657806002610d68610d62610c0e94610ca3565b92610c7a565b50015460801c90610c96565b60405163264d985160e11b81526001600160a01b0392831660048201525f9392909160209183916024918391165afa5f9181610db7575b50610db35750565b9150565b610dd191925060203d6020116106a3576106958183610c3a565b905f610dab565b60025f5414610de75760025f55565b633ee5aeb560e01b5f5260045ffd5b90610e0082610d46565b91821561101557610e1081610c7a565b509060028201916001600160801b038516835460801c016001600160801b0381116104ed5783546001600160801b031660809190911b6001600160801b031916178355546040516370a0823160e01b81526001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081166004830181905292169390602081602481885afa908115610549575f91610fe3575b5060405163a9059cbb60e01b60208201526001600160a01b038416602482015260448082018990528152610eed90610ee7606482610c3a565b8661101b565b6040516370a0823160e01b81526004810184905290602082602481895afa8015610549575f90610faf575b610f229250610c96565b91803b1561012e5760405163ef6506db60e01b81526001600160a01b038616600482015260248101939093525f908390604490829084905af1908115610549577f458d4bd7c234bb020dabfd1047534f329affea09dd1245a732540db0b114921592604092610f9f575b505460801c8151908782526020820152a3565b5f610fa991610c3a565b5f610f8c565b506020823d602011610fdb575b81610fc960209383610c3a565b8101031261012e57610f229151610f18565b3d9150610fbc565b90506020813d60201161100d575b81610ffe60209383610c3a565b8101031261012e57515f610eae565b3d9150610ff1565b505f9150565b81516001600160a01b03909116915f91829160200182855af13d156110c2573d67ffffffffffffffff811161059a5761107691604051916110666020601f19601f8401160184610c3a565b82523d5f602084013e5b836110ce565b805190811515918261109e575b505061108c5750565b635274afe760e01b5f5260045260245ffd5b819250906020918101031261012e576020015180159081150361012e575f80611083565b61107690606090611070565b906110f257508051156110e357805190602001fd5b630a12f52160e11b5f5260045ffd5b81511580611123575b611103575090565b639996b31560e01b5f9081526001600160a01b0391909116600452602490fd5b50803b156110fb56fea2646970667358221220767c11e026f804ac72875ebdf07baba7c3e266394d2ee4ed075a57ca67773a0864736f6c634300081a0033" as `0x${string}`;
// constructor(factoryA, factoryB, distributor)
export const SLICE_ESCROW_ARGS = [
  "0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2",
  "0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2",
  "0x5ca4B6bc4e40C6E7120b8d28467cc6b00410c0E0", // distributor (expected, nonce 51)
] as const;
export const SLICE_LIMITS = {
  defaultBps: 50, uiMinBps: 25, uiMaxBps: 100, contractMinBps: 25, contractMaxTotalBps: 500,
  defaultDurationDays: 90, minDurationDays: 30, maxDurationDays: 365,
  epochSeconds: 604800, epochGenesis: 1794096000, warmupSeconds: 604800, rootDelaySeconds: 86400,
} as const;
export const SLICE_ROOT_POSTER = "0xd75492a45Ceed467d2147cBa74A9595b949E491E" as const;
export const SLICE_ROOTS_URL = "https://raw.githubusercontent.com/polydash-labs/Polydash/main/slice-roots/" as const; // epoch_<N>.json + latest.json
export const SLICE_GAS = { distributorDeploy: 1600000n, escrowDeploy: 1800000n, writeMin: 500000n } as const;
export const LAUNCH_MIN_ABI = [
 {"type":"function","name":"creator","inputs":[],"outputs":[{"type":"address"}],"stateMutability":"view"},
 {"type":"function","name":"token","inputs":[],"outputs":[{"type":"address"}],"stateMutability":"view"}
] as const;
