// ---- POLYDASH Rewards Pool (deploy FIRST, admin wallet nonce 49) ----
export const REWARDS_POOL_EXPECTED_ADDRESS = "0x608d106Bb58A804fcd45823e0C6087801dee2aCa" as const;
export const BUYBACK_VAULT_EXPECTED_ADDRESS = "0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193" as const; // nonce 50
export const REWARDS_POOL_ABI = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "_token",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "MIN_RESTREAM_BPS",
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
  "name": "REWARDS_DURATION",
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
  "name": "acceptsRewardTopUps",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "pure"
 },
 {
  "type": "function",
  "name": "balanceOf",
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
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "carryScaled",
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
  "name": "claim",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "donations",
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
  "name": "earned",
  "inputs": [
   {
    "name": "a",
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
  "name": "endTime",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "pure"
 },
 {
  "type": "function",
  "name": "exit",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "lastTimeRewardApplicable",
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
  "name": "lastUpdateTime",
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
  "name": "notifyRewardAmount",
  "inputs": [
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
  "name": "periodFinish",
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
  "name": "restreamCarry",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "rewardPerSecond",
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
  "name": "rewardPerToken",
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
  "name": "rewardPerTokenStored",
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
  "name": "rewardRate",
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
  "name": "rewardReserve",
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
  "name": "rewardToken",
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
  "name": "rewards",
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
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "stake",
  "inputs": [
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
  "name": "stakeToken",
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
  "name": "syncDonations",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "token",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IERC20"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "totalClaimed",
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
  "name": "totalNotified",
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
  "name": "totalStaked",
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
  "name": "userRewardPerTokenPaid",
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
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "withdraw",
  "inputs": [
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
  "type": "event",
  "name": "Restreamed",
  "inputs": [
   {
    "name": "carried",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "rewardRate",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "periodFinish",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RewardAdded",
  "inputs": [
   {
    "name": "from",
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
    "name": "rewardRate",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "periodFinish",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RewardPaid",
  "inputs": [
   {
    "name": "user",
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
  "name": "Staked",
  "inputs": [
   {
    "name": "user",
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
  "name": "Withdrawn",
  "inputs": [
   {
    "name": "user",
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
  "name": "FailedInnerCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "Insufficient",
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
  "name": "ZeroAmount",
  "inputs": []
 }
] as const;
export const REWARDS_POOL_BYTECODE = "0x60a03460a357601f61124d38819003918201601f19168301916001600160401b0383118484101760a75780849260209460405283398101031260a357516001600160a01b0381169081900360a35760015f55801560945760805260405161119190816100bc8239608051818181610182015281816103440152818161074301528181610abe01528181610bf00152610f7c0152f35b631f2a200560e01b5f5260045ffd5b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe60806040526004361015610011575f80fd5b5f3560e01c80628cc26214610941578063017d0834146109265780630700037d146108ea5780630b8f9928146108cf5780632e1a7d4d146108aa5780633197cbb61461088f57806337eb915c1461085d5780633c6b16ab146107035780634e71d92d146106eb57806351ed6a30146101b55780635a4cd9fa146105f657806370a08231146105ba5780637b0a47ee1461059d57806380faa57d14610583578063817b1cd21461056657806389f12b6e146105495780638b8763471461050d5780638f10369a146104d4578063a694fc3a146102fe578063c2e17163146102e1578063c8f33c91146102c4578063cab64bcd146102a7578063cd3daf9d1461028d578063d54ad2a114610270578063df136d6514610253578063e8757d1914610231578063e9fad8ee146101f4578063ebe2b12b146101d7578063f4542494146101ba578063f7c618c1146101b55763fc0c546a1461016d575f80fd5b346101b1575f3660031901126101b1576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5f80fd5b61016d565b346101b1575f3660031901126101b157602060405162278d008152f35b346101b1575f3660031901126101b1576020600454604051908152f35b346101b1575f3660031901126101b15761020c610b4f565b335f52600260205261022260405f205433610b6d565b61022b33610efd565b60015f55005b346101b1575f3660031901126101b157602061024b610aa3565b604051908152f35b346101b1575f3660031901126101b1576020600654604051908152f35b346101b1575f3660031901126101b1576020600c54604051908152f35b346101b1575f3660031901126101b157602061024b610a66565b346101b1575f3660031901126101b1576020600954604051908152f35b346101b1575f3660031901126101b1576020600554604051908152f35b346101b1575f3660031901126101b1576020600a54604051908152f35b346101b15760203660031901126101b15760043561031a610b4f565b80156104c55761032933610c9d565b6001546040516370a0823160e01b81523060048201529015917f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0381169190602084602481865afa938415610482575f9461048d575b509161039b6020926024959430903390610eb2565b6040516370a0823160e01b815230600482015293849182905afa8015610482575f9061044e575b6103cc9250610970565b906103d9826001546109ae565b600155335f52600260205260405f206103f38382546109ae565b90558061043f575b610432575b6040519081527f9e71bc8eea02a63969f509818f2dafb9254532904319f9dbda79b67bd34a5f3d60203392a260015f55005b61043a610fa5565b610400565b5062278d00600a5410156103fb565b506020823d60201161047a575b8161046860209383610a1f565b810103126101b1576103cc91516103c2565b3d915061045b565b6040513d5f823e3d90fd5b9350916020843d6020116104bd575b816104a960209383610a1f565b810103126101b1579251929161039b610386565b3d915061049c565b631f2a200560e01b5f5260045ffd5b346101b1575f3660031901126101b157600454421015610505576020670de0b6b3a764000060035404604051908152f35b60205f61024b565b346101b15760203660031901126101b1576004356001600160a01b038116908190036101b1575f526007602052602060405f2054604051908152f35b346101b1575f3660031901126101b1576020600b54604051908152f35b346101b1575f3660031901126101b1576020600154604051908152f35b346101b1575f3660031901126101b157602061024b610a55565b346101b1575f3660031901126101b1576020600354604051908152f35b346101b15760203660031901126101b1576004356001600160a01b038116908190036101b1575f526002602052602060405f2054604051908152f35b346101b1575f3660031901126101b15761060e610b4f565b610616610c2c565b600a5462278d00811080156106e1575b6104c5576004548042105f146106da5761064461064d914290610970565b6003549061097d565b612710820282810461271014831517156106c6576064820291808304606414901517156106c657106104c5577ffadfc0024851bf9a1ce8e55c6786b6e1b508cce912c3f4abd5b113affc241880906106a3610fa5565b60035460045460408051938452602084019290925290820152606090a160015f55005b634e487b7160e01b5f52601160045260245ffd5b505f61064d565b5060015415610626565b346101b1575f3660031901126101b157610222610b4f565b346101b15760203660031901126101b15760043561071f610b4f565b80156104c55761072d610c2c565b6040516370a0823160e01b8152306004820152907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0381169190602084602481865afa938415610482575f94610825575b509161079960209260249430903390610eb2565b6040516370a0823160e01b815230600482015292839182905afa908115610482575f916107f1575b61022b6107ce8484610970565b6107da816009546109ae565b6009556107e981600b546109ae565b600b55610d24565b90506020813d60201161081d575b8161080c60209383610a1f565b810103126101b1575161022b6107c1565b3d91506107ff565b929093506020833d602011610855575b8161084260209383610a1f565b810103126101b157915192610799610785565b3d9150610835565b346101b1575f3660031901126101b157610875610b4f565b61087d610aa3565b80156104c55761022b906107ce610c2c565b346101b1575f3660031901126101b15760206040515f198152f35b346101b15760203660031901126101b1576108c3610b4f565b61022b60043533610b6d565b346101b1575f3660031901126101b157602060405160648152f35b346101b15760203660031901126101b1576004356001600160a01b038116908190036101b1575f526008602052602060405f2054604051908152f35b346101b1575f3660031901126101b157602060405160018152f35b346101b15760203660031901126101b1576004356001600160a01b03811681036101b15761024b6020916109bb565b919082039182116106c657565b818102929181159184041417156106c657565b811561099a570490565b634e487b7160e01b5f52601260045260245ffd5b919082018092116106c657565b6001600160a01b03165f81815260086020908152604080832054600290925290912054610a1c92670de0b6b3a764000091610a1591610a0f906109fc610a66565b905f52600760205260405f205490610970565b9061097d565b04906109ae565b90565b90601f8019910116810190811067ffffffffffffffff821117610a4157604052565b634e487b7160e01b5f52604160045260245ffd5b6004548042105f14610a1c57504290565b6001548015610a9c57610a1c90610a9660065491610a91610644610a88610a55565b60055490610970565b610990565b906109ae565b5060065490565b6040516370a0823160e01b81523060048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610482575f91610b1d575b50610b06600154600954906109ae565b80821115610b1757610a1c91610970565b50505f90565b90506020813d602011610b47575b81610b3860209383610a1f565b810103126101b157515f610af6565b3d9150610b2b565b60025f5414610b5e5760025f55565b633ee5aeb560e01b5f5260045ffd5b9080156104c5576001600160a01b0382165f818152600260205260409020549092908211610c1d5781610c147f7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d59383610bc7602095610c9d565b865f526002855260405f20610bdd838254610970565b9055610beb82600154610970565b6001557f000000000000000000000000000000000000000000000000000000000000000061100f565b604051908152a2565b631dc930eb60e01b5f5260045ffd5b610c34610a55565b60015480610c5f5750610c57610c4f61064460055484610970565b600a546109ae565b600a55600555565b610c4f610c5791610c97610c7861064460055487610970565b91610c838184610990565b610c8f816006546109ae565b60065561097d565b90610970565b610ca5610a55565b60015480610d035750610cc0610c4f61064460055484610970565b600a555b6005556001600160a01b0381169081610cdb575050565b610ce4906109bb565b815f52600860205260405f2055600654905f52600760205260405f2055565b610c4f610d1c91610c97610c7861064460055487610970565b600a55610cc4565b6004548042105f14610eac57610d3d6106444283610970565b670de0b6b3a7640000830291838304670de0b6b3a7640000148415171591826106c65769021e19e0c9bab2400000850284810461271014851517156106c6576064820291808304606414901517156106c65710610e5957506106c657610dc8906004548042105f14610e4f57610dba610644610dc3924290610970565b600a54906109ae565b6109ae565b62278d0081048060035562278d0081029080820462278d0014901517156106c657610df291610970565b600a554260055562278d0042018042116106c657600481905560035460408051938452602084019190915282015233907f0727302becd070529b3293f4ec8f553d9f6ae1773f638598db1205fbf89080839080606081015b0390a2565b50610dc35f610dba565b9050610e887f0727302becd070529b3293f4ec8f553d9f6ae1773f638598db1205fbf890808392600a546109ae565b600a5560035460408051948552602085019190915283015233918060608101610e4a565b5f610d3d565b6040516323b872dd60e01b60208201526001600160a01b039283166024820152929091166044830152606480830193909352918152610efb91610ef6608483610a1f565b61104a565b565b610f0681610c9d565b6001600160a01b0381165f8181526008602052604090205490918115610fa05781610c147fe2403640ba68fed3a2f88b7557551d1993f84b99bb10ff833f0cf8db0c5e048693602093865f52600885525f6040812055610f6882600954610970565b600955610f7782600c546109ae565b600c557f000000000000000000000000000000000000000000000000000000000000000061100f565b505050565b6004548042105f1461100557610dba610644610fc2924290610970565b62278d0081048060035562278d0081029080820462278d0014901517156106c657610fec91610970565b600a554260055562278d0042018042116106c657600455565b50610fc25f610dba565b60405163a9059cbb60e01b60208201526001600160a01b039092166024830152604480830193909352918152610efb91610ef6606483610a1f565b81516001600160a01b03909116915f91829160200182855af13d156110f1573d67ffffffffffffffff8111610a41576110a591604051916110956020601f19601f8401160184610a1f565b82523d5f602084013e5b836110fd565b80519081151591826110cd575b50506110bb5750565b635274afe760e01b5f5260045260245ffd5b81925090602091810103126101b157602001518015908115036101b1575f806110b2565b6110a59060609061109f565b90611121575080511561111257805190602001fd5b630a12f52160e11b5f5260045ffd5b81511580611152575b611132575090565b639996b31560e01b5f9081526001600160a01b0391909116600452602490fd5b50803b1561112a56fea2646970667358221220b6df08fbd28204c3f81e67579a8d6a87242736c4978a0916a2323088bb2a546164736f6c634300081a0033" as `0x${string}`;
export const REWARDS_POOL_ARGS = ["0x319525528f42167eF7fC18b77b889958080568e4"] as const; // constructor(POLYDASH)
export const REWARDS_POOL_LIMITS = { streamDays: 30, minRestreamBps: 100 } as const;

// PolydashBuybackVault deploy artifacts (generated; do not edit by hand). Not audited.
export const BUYBACK_VAULT_ABI = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "p",
    "type": "tuple",
    "internalType": "struct PolydashBuybackVault.Init",
    "components": [
     {
      "name": "poolManager",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "weth",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "polydash",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "hook",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "poolFee",
      "type": "uint24",
      "internalType": "uint24"
     },
     {
      "name": "tickSpacing",
      "type": "int24",
      "internalType": "int24"
     },
     {
      "name": "factoryA",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "factoryB",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "maxBuyEth",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "maxSlippageBps",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "maxPoolFeeBps",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "burnShareBps",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "stakingFactory",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "targetAdmin",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "initialTarget",
      "type": "address",
      "internalType": "address"
     }
    ]
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "receive",
  "stateMutability": "payable"
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
  "name": "BUY_COOLDOWN",
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
  "name": "DEAD",
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
  "name": "MAX_DEVIATION_BPS",
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
  "name": "MIN_TARGET_REMAINING",
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
  "name": "NO_TARGET_BURN_DELAY",
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
  "name": "OBS_DELAY",
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
  "name": "OBS_MAX_AGE",
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
  "name": "TARGET_TIMELOCK",
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
  "name": "burnHeldStaking",
  "inputs": [],
  "outputs": [
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "burnShareBps",
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
  "name": "buy",
  "inputs": [],
  "outputs": [
   {
    "name": "ethIn",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "burned",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "toStakers",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "buyCount",
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
  "name": "buyback",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "cancelTarget",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "createdAt",
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
  "name": "executeTarget",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
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
  "name": "heldForStakers",
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
  "name": "hook",
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
  "name": "inactiveSince",
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
  "name": "initialTarget",
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
  "name": "isValidTarget",
  "inputs": [
   {
    "name": "t",
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
  "name": "lastBuyTime",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "maxBuyEth",
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
  "name": "maxPoolFeeBps",
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
  "name": "maxSlippageBps",
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
  "name": "minPolydashOut",
  "inputs": [
   {
    "name": "ethIn",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "sqrtP",
    "type": "uint160",
    "internalType": "uint160"
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
  "name": "nextStep",
  "inputs": [],
  "outputs": [
   {
    "name": "step",
    "type": "uint8",
    "internalType": "uint8"
   },
   {
    "name": "at",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "obsSqrtPriceX96",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint160",
    "internalType": "uint160"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "obsTime",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "observePrice",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "pendingEth",
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
  "name": "pendingTarget",
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
  "name": "pendingTargetAt",
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
  "name": "polydash",
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
  "name": "poolFee",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint24",
    "internalType": "uint24"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "poolFeeBps",
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
  "name": "poolId",
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
  "name": "poolKey",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct PoolKey",
    "components": [
     {
      "name": "currency0",
      "type": "address",
      "internalType": "Currency"
     },
     {
      "name": "currency1",
      "type": "address",
      "internalType": "Currency"
     },
     {
      "name": "fee",
      "type": "uint24",
      "internalType": "uint24"
     },
     {
      "name": "tickSpacing",
      "type": "int24",
      "internalType": "int24"
     },
     {
      "name": "hooks",
      "type": "address",
      "internalType": "contract IHooks"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "poolManager",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IPoolManager"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "proposeTarget",
  "inputs": [
   {
    "name": "target",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "releaseToTarget",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "rewardsTarget",
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
  "name": "spotSqrtPriceX96",
  "inputs": [],
  "outputs": [
   {
    "name": "s",
    "type": "uint160",
    "internalType": "uint160"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "stakingFactory",
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
  "name": "targetActive",
  "inputs": [],
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
  "name": "targetAdmin",
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
  "name": "targetClearedAt",
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
  "name": "targetEndTime",
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
  "name": "tickSpacing",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "int24",
    "internalType": "int24"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "topUp",
  "inputs": [],
  "outputs": [],
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "totalBurned",
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
  "name": "totalDirect",
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
  "name": "totalEthSpent",
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
  "name": "totalFromFactories",
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
  "name": "totalManual",
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
  "name": "totalReceived",
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
  "name": "totalReleased",
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
  "name": "totalStakingBurned",
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
  "name": "totalToStakers",
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
  "name": "unlockCallback",
  "inputs": [
   {
    "name": "data",
    "type": "bytes",
    "internalType": "bytes"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bytes",
    "internalType": "bytes"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "weth",
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
  "name": "BoughtAndBurned",
  "inputs": [
   {
    "name": "caller",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "ethIn",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "polydashBurned",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "polydashToStakers",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "sqrtPriceBefore",
    "type": "uint160",
    "indexed": false,
    "internalType": "uint160"
   },
   {
    "name": "sqrtPriceAfter",
    "type": "uint160",
    "indexed": false,
    "internalType": "uint160"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "HeldStakingBurned",
  "inputs": [
   {
    "name": "caller",
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
  "name": "PriceObserved",
  "inputs": [
   {
    "name": "caller",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "sqrtPriceX96",
    "type": "uint160",
    "indexed": false,
    "internalType": "uint160"
   },
   {
    "name": "at",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Received",
  "inputs": [
   {
    "name": "source",
    "type": "uint8",
    "indexed": true,
    "internalType": "enum PolydashBuybackVault.Source"
   },
   {
    "name": "from",
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
  "name": "RewardsReleased",
  "inputs": [
   {
    "name": "target",
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
  "name": "TargetCancelled",
  "inputs": [
   {
    "name": "target",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "TargetChanged",
  "inputs": [
   {
    "name": "oldTarget",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "newTarget",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "TargetProposed",
  "inputs": [
   {
    "name": "target",
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
  "type": "error",
  "name": "Cooldown",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidParams",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidTarget",
  "inputs": []
 },
 {
  "type": "error",
  "name": "MathOverflowedMulDiv",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoActiveTarget",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoFreshObservation",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoPending",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotPoolManager",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotTargetAdmin",
  "inputs": []
 },
 {
  "type": "error",
  "name": "Nothing",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NothingPending",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ObservationNotDue",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PriceMoved",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ReentrancyGuardReentrantCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "Slippage",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TargetActive",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TimelockActive",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TooEarly",
  "inputs": []
 }
] as const;

export const BUYBACK_VAULT_BYTECODE = "0x61028060405234610501576101e06134ca803803809161002182610280610519565b6102803912610501576040516101e081016001600160401b038111828210176105055760405261005261028061053c565b8082526100606102a061053c565b60208301819052906100736102c061053c565b60408401819052916100866102e061053c565b60608501526103005162ffffff8116810361050157608085015261032051600281900b81036105015760a085018190526100c161034061053c565b60c08601526100d161036061053c565b60e08601526103805161010086018190526103a05161012087018190526103c05161014088018190526103e0516101608901819052939290919061011661040061053c565b6101808a018190529561012a61042061053c565b6101a08b018190529761013e61044061053c565b6101c08c015260015f556001600160a01b0316159889156104ef575b89156104dd575b89156104c5575b505087156104bc575b5086156104b3575b86156104a7575b50851561049b575b50841561048b575b50831561047f575b50821561046d575b50811561045b575b5061044c5780516001600160a01b0390811660809081526020830151821660a09081526040840151831660c09081526060850151841660e09081529285015162ffffff166101009081529185015160020b61012090815290850151841661014090815292850151841661016090815291850151610180908152908501516101a0908152928501516101c0908152918501516101e052840151831661020052908301518216610220524261026052820180518216610240525116806103f2575b604051612cfb90816107cf82396080518181816104b8015281816107a8015281816108be0152610e23015260a051818181611297015281816118030152611f17015260c0518181816103d501528181610fba0152818161184701528181611c2201528181611f3c0152818161206e015281816120c90152612865015260e0518181816115f901528181611fb801526122d6015261010051818181611d870152611f680152610120518181816106390152611f8f015261014051818181610314015261276e0152610160518181816117600152612802015261018051818181610939015261163f01526101a0518181816106fa01528181610965015261258201526101c051818181611967015281816123d30152818161240c015261246901526101e051818181610f7601526118b201526102005181818161199f015261222301526102205181818161052701528181610d13015281816114e50152611a6b0152610240518181816119070152612014015261026051818181610677015281816124bd01526124ed0152f35b600180546001600160a01b0319168217905561040d90610568565b1561044c576101c001516001600160a01b03165f7f4d11d6210a5e807da812a693b5d341a870571b5fc31158172207a3d99c911ccd8180a35f80610267565b635435b28960e11b5f5260045ffd5b6001600160a01b03161590505f6101a8565b6001600160a01b03161591505f6101a0565b6127101092505f610198565b5f91945060020b1315925f610190565b6103e81094505f610188565b6103e81095505f610180565b80159650610179565b1596505f610171565b6001600160a01b039081169116101597505f80610168565b6001600160a01b038116159950610161565b6001600160a01b03821615995061015a565b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b601f909101601f19168101906001600160401b0382119082101761050557604052565b51906001600160a01b038216820361050157565b90816020910312610501575180151581036105015790565b803b156106b557610240516001600160a01b0391821691168103610763575b60405163f7c618c160e01b8152602081600481855afa5f9181610727575b506105b05750505f90565b60c0516001600160a01b039081169116036106b55760405163051ed6a360e41b8152602081600481855afa5f91816106eb575b506105ee5750505f90565b60c0516001600160a01b039081169116036106b557604051625f420d60e21b8152602081600481855afa5f91816106ba575b5061062b5750505f90565b156106b5576020600491604051928380926318cbe5db60e11b82525afa5f9181610681575b5061065a57505f90565b6201518042019081421161066d57101590565b634e487b7160e01b5f52601160045260245ffd5b9091506020813d6020116106ad575b8161069d60209383610519565b810103126105015751905f610650565b3d9150610690565b505f90565b6106dd91925060203d6020116106e4575b6106d58183610519565b810190610550565b905f610620565b503d6106cb565b9091506020813d60201161071f575b8161070760209383610519565b81010312610501576107189061053c565b905f6105e3565b3d91506106fa565b9091506020813d60201161075b575b8161074360209383610519565b81010312610501576107549061053c565b905f6105a5565b3d9150610736565b61020051604051635b16ebb760e01b81526004810183905290602090829060249082906001600160a01b03165afa5f91816107ad575b506107a45750505f90565b61058757505f90565b6107c791925060203d6020116106e4576106d58183610519565b905f61079956fe6080806040526004361015610037575b50361561001a575f80fd5b60405134815260025f80516020612ca683398151915260203393a3005b5f905f3560e01c90816302e602e814611de35750806303fd2a4514611dc757806306ccbf5014611dab578063089fe6aa14611d6c5780630f90bca314611bce578063133f2d0e14611bb1578063182148ef14611b885780632266806614611a5157806323bc62b814611a34578063249d39e914611a1857806325c68403146119fd5780632856e96a146119ce578063291347681461198a5780633281cf471461195057806337e1b65a1461193657806337ef60d4146118f257806337f09e6d146118d55780633de2271c1461189b5780633e0dc34e146118765780633f34908f146118325780633fc8cef3146117ee5780634c0617b5146117d25780634c0c2be5146117b757806358ea52a51461178f5780635eb1c5711461174b5780635f8531fa14611731578063600a5f52146116da57806365bc4458146116a757806377fa85ed1461167f5780637ad8128c146116625780637ef54185146116285780637f5a7c7b146115e45780638070fea9146115c7578063814fa4d7146115aa57806381afbc1614611576578063824878441461154e578063876f99ce1461153157806389a93e1c1461151457806389b34f8d146114d05780638c08c27e146114b657806391dd734614610dcc57806392d3b88614610dae5780639d2849bc14610d00578063a3c2c46214610ce0578063a6f2ae3a14610857578063b0d07baf14610760578063b0ecfb771461073b578063b17be4c11461071d578063c4aa7395146106e2578063c9000726146106b8578063ca7030751461069a578063cf09e0d01461065f578063d0c93a7c14610621578063d89135cd14610603578063db2bb06d146104fe578063dc29f1de146104e7578063dc4c90d3146104a2578063dc5ba7bd14610478578063e33b7de31461045a578063eef70798146103a8578063f29f4d0b14610381578063f8cddf2014610364578063f8ec6911146103465763fd6916450361000f57346103435780600319360112610343576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b80fd5b508060031936011261034357602061035c612765565b604051908152f35b50346103435780600319360112610343576020604051610e108152f35b503461034357806003193601126103435760206001600160401b0360095416604051908152f35b50346103435780600319360112610343576040516370a0823160e01b8152306004820152906020826024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa90811561044e5790610417575b602090604051908152f35b506020813d602011610446575b8161043160209383611e93565b81010312610442576020905161040c565b5f80fd5b3d9150610424565b604051903d90823e3d90fd5b50346103435780600319360112610343576020600654604051908152f35b503461034357806003193601126103435760206001600160401b0360085460a01c16604051908152f35b50346103435780600319360112610343576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5080600319360112610343576104fb612731565b80f35b5034610343576020366003190112610343576004356001600160a01b038116908181036105ff577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036105f05781151590816105df575b506105d057806bffffffffffffffffffffffff60a01b60025416176002556202a30042018042116105bc576020817f022256c98e3b93f83b0004ad08342b08a5fdd503a157c78d3ea437ace80c23e192600355604051908152a280f35b634e487b7160e01b83526011600452602483fd5b63416aebb560e11b8252600482fd5b6105e99150611fff565b155f61055f565b6331799fc960e11b8352600483fd5b8280fd5b50346103435780600319360112610343576020600e54604051908152f35b503461034357806003193601126103435760206040517f000000000000000000000000000000000000000000000000000000000000000060020b8152f35b503461034357806003193601126103435760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b50346103435780600319360112610343576020600f54604051908152f35b503461034357806003193601126103435760406106d3612657565b60ff8351921682526020820152f35b503461034357806003193601126103435760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b50346103435780600319360112610343576020600754604051908152f35b50346103435780600319360112610343576020610756612633565b6040519015158152f35b5034610343578060031936011261034357610779612830565b6008546001600160401b038160a01c168015159081610840575b50610831576107cc60a06107a5611edb565b207f0000000000000000000000000000000000000000000000000000000000000000612a4e565b50505060018060a01b031690816001600160401b0360a01b4260a01b169163ffffffff60e01b1617176008556040519081524260208201527f7dd06f5066fa549e9f4abf37b83b74f2fa9a7b8b26c9070e825bcd97b21df3f460403392a26001815580f35b630fff4ff760e31b8252600482fd5b9050610e1081018091116105bc574211155f610793565b5034610343578060031936011261034357610870612830565b47908115610cd157600954916001600160401b0383168015159081610cbb575b50610cac57600854916001600160401b038360a01c168015908115610c96575b8115610c6c575b50610c5d577f0000000000000000000000000000000000000000000000000000000000000000926001600160a01b03811692906108fe60a06108f7611edb565b2086612a4e565b5050506001600160a01b03169161091e6109188685612b07565b80612bc7565b670d99a8cec7e200008110159081610c4a575b5015610c3b577f000000000000000000000000000000000000000000000000000000000000000080821015610c335750955b7f000000000000000000000000000000000000000000000000000000000000000060011c612710036127108111610c1f5791610a2e979185936127106109b060018060a01b03928a612529565b0416916401000276a3831115610c12575b67ffffffffffffffff60a01b191660085567ffffffffffffffff1916426001600160401b0316176009556040805160208101939093526001600160a01b0391909116828201528152610a14606082611e93565b604051809781926348c8949160e01b835260048301611e41565b0381836001600160a01b0389165af1948515610c07578295610b88575b50606085805181010312610b845760208501519360606040870151960151938515908115610b67575b50610b5857610a8585600d54611e6b565b600d55610a9486600e54611e6b565b600e55610aa384600554611e6b565b600555600f5460018101809111610b445791610ad5610b40959492600194600f5560a0610ace611edb565b2090612a4e565b505050604051918783528860208401528560408401526060830152838060a01b031660808201527f9fde2c69b862965b7dafe60064b322a346b77fd9ca7fcf6869d3d014ef4705b660a03392a255604051938493846040919493926060820195825260208201520152565b0390f35b634e487b7160e01b84526011600452602484fd5b6307dd37f760e41b8352600483fd5b9050610b7d610b768689611e6b565b918761253c565b115f610a74565b5080fd5b9094503d8083833e610b9a8183611e93565b8101906020818303126105ff578051906001600160401b038211610c03570181601f820112156105ff57805190610bd08261228a565b92610bde6040519485611e93565b82845260208383010111610c035781849260208093018386015e83010152935f610a4b565b8380fd5b6040513d84823e3d90fd5b6401000276a492506109c1565b634e487b7160e01b85526011600452602485fd5b905095610963565b6338aa5c1560e01b8452600484fd5b670e27c49886e60000915011155f610931565b63d904906f60e01b8152600490fd5b9050610e108101809111610c825742115f6108b7565b634e487b7160e01b82526011600452602482fd5b905061012c81018082116105bc574210906108b0565b63b0782df760e01b8252600482fd5b905061025881018091116105bc5742105f610890565b630bae0d7560e11b8152600490fd5b5034610343578060031936011261034357602061035c600d544790611e6b565b50346103435780600319360112610343577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303610d9f5760035415610d9057600280546001600160a01b0319811690915560038290556001600160a01b03167f3d1aa8ffee35c2d13b462ce38d0dd942ef4b681da5ed6cbc2f455696fe9079258280a280f35b63369d55ef60e21b8152600490fd5b6331799fc960e11b8152600490fd5b50346103435780600319360112610343576020600d54604051908152f35b503461044257602036600319011261044257600435906001600160401b0382116104425736602383011215610442578160040135906001600160401b038211610442576024830191830191366024840111610442577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031692338490036114a757602482604092030112610442573592604401356001600160a01b03811691908281036104425750610e83611edb565b91600160ff1b851461144357604051606081018181106001600160401b0382111761149357604052600181526020810190865f03825260408101928352610edb60405195633cf3645360e21b87526004870190611dfe565b51151560a48501525160c484015260018060a01b0390511660e48301526101206101048301525f610124830152602082610144815f875af1918215611421575f9261145f575b5081600f0b9160801d600f0b5f81125f14611457576f7fffffffffffffffffffffffffffffff198114611443575f03600f0b915b5f81131561143b57935b821161142c5781611295575b610fa3612710610f9b7f000000000000000000000000000000000000000000000000000000000000000087612529565b04809561251c565b6040516370a0823160e01b815261dead60048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316949091602083602481895afa92831561128a578493611256575b506040516370a0823160e01b8152306004820152966020886024818a5afa978815611213578598611222575b50806111b9575b5080611161575b50506040516370a0823160e01b815261dead600482015290602082602481885afa918215611156578392611120575b5061107460209160249361251c565b94604051928380926370a0823160e01b82523060048301525afa91821561044e57916110ea575b50906110d06110b0610b40956110de9461251c565b604051948593602085016040919493926060820195825260208201520152565b03601f198101835282611e93565b60405191829182611e41565b9190506020823d602011611118575b8161110660209383611e93565b810103126104425790516110d061109b565b3d91506110f9565b91506020823d60201161114e575b8161113b60209383611e93565b8101031261044257905190611074611065565b3d915061112e565b6040513d85823e3d90fd5b813b15610c03578390604051928391630b0d9c0960e01b835288600484015230602484015260448301528183606482800301925af18015611156579083911561103657816111ae91611e93565b610b8457815f611036565b823b1561121e5760405190630b0d9c0960e01b825287600483015261dead60248301526044820152848160648183875af18015611213579085916111fe575b5061102f565b8161120891611e93565b610c0357835f6111f8565b6040513d87823e3d90fd5b8480fd5b9097506020813d60201161124e575b8161123e60209383611e93565b810103126104425751965f611028565b3d9150611231565b9092506020813d602011611282575b8161127260209383611e93565b810103126104425751915f610ffc565b3d9150611265565b6040513d86823e3d90fd5b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b1561044257604051630d0e30db60e41b81525f8160048187865af180156114215761140c575b50833b15610b8457604051632961046560e21b815260048101829052828160248183895af18015611156579083916113f7575b505060405163a9059cbb60e01b81526001600160a01b038516600482015260248101849052906020908290604490829086905af1908115610c075782916113c8575b50156113b957604051630476982d60e21b815260208160048185885af18015610c075761138a575b50610f6b565b6113ab9060203d6020116113b2575b6113a38183611e93565b810190611eb4565b505f611384565b503d611399565b6307dd37f760e41b8152600490fd5b6113ea915060203d6020116113f0575b6113e28183611e93565b810190611ec3565b5f61135c565b503d6113d8565b8161140191611e93565b610b8457815f61131a565b6114199192505f90611e93565b5f905f6112e7565b6040513d5f823e3d90fd5b6307dd37f760e41b5f5260045ffd5b505f93610f5f565b634e487b7160e01b5f52601160045260245ffd5b505f91610f55565b9091506020813d60201161148b575b8161147b60209383611e93565b810103126104425751905f610f21565b3d915061146e565b634e487b7160e01b5f52604160045260245ffd5b63570c108560e11b5f5260045ffd5b34610442575f36600319011261044257602061035c6125c0565b34610442575f366003190112610442576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610442575f3660031901126104425760206040516202a3008152f35b34610442575f366003190112610442576020600454604051908152f35b34610442575f366003190112610442576001546040516001600160a01b039091168152602090f35b34610442575f36600319011261044257602061159560a06107a5611edb565b50506040516001600160a01b03909216825250f35b34610442575f366003190112610442576020600b54604051908152f35b34610442575f366003190112610442576020600c54604051908152f35b34610442575f366003190112610442576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610442575f3660031901126104425760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610442575f366003190112610442576020600554604051908152f35b34610442575f366003190112610442576008546040516001600160a01b039091168152602090f35b34610442576040366003190112610442576024356004356001600160a01b03821682036104425760209161035c9161253c565b34610442575f366003190112610442576116f2612830565b6001546001600160a01b0316611706612633565b156117225761171660209161284e565b60015f55604051908152f35b635f84801360e11b5f5260045ffd5b34610442575f36600319011261044257602061035c612496565b34610442575f366003190112610442576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610442575f366003190112610442576002546040516001600160a01b039091168152602090f35b34610442575f36600319011261044257602047604051908152f35b34610442575f3660031901126104425760206040516102588152f35b34610442575f366003190112610442576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610442575f366003190112610442576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610442575f36600319011261044257602060a0611892611edb565b20604051908152f35b34610442575f3660031901126104425760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610442575f366003190112610442576020600354604051908152f35b34610442575f366003190112610442576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610442575f36600319011261044257602061035c6122d4565b34610442575f3660031901126104425760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610442575f366003190112610442576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610442576020366003190112610442576004356001600160a01b038116810361044257610756602091611fff565b34610442575f36600319011261044257602060405160c88152f35b34610442575f3660031901126104425760206040516127108152f35b34610442575f366003190112610442576020600a54604051908152f35b34610442575f36600319011261044257611a69612830565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303611b79576003548015611b6a574210611b5b576002546001600160a01b0381169081158015918280611b4b575b611b3c57600180546001600160a01b0319808216871790925591166002555f6003558391611b33575b6001600160a01b03167f4d11d6210a5e807da812a693b5d341a870571b5fc31158172207a3d99c911ccd5f80a3611b23575b60015f55005b611b2c9061284e565b5080611b1d565b42600455611aeb565b63416aebb560e11b5f5260045ffd5b50611b5584611fff565b15611ac2565b637d857b6760e01b5f5260045ffd5b63369d55ef60e21b5f5260045ffd5b6331799fc960e11b5f5260045ffd5b34610442575f3660031901126104425760a0611ba2611edb565b611baf6040518092611dfe565bf35b34610442575f366003190112610442576020604051620151808152f35b34610442575f36600319011261044257611be6612830565b611bee612633565b611d5d57611bfa612496565b62278d008101809111611443574210611d4e576040516370a0823160e01b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316602082602481845afa918215611421575f92611d1a575b508115611cec5760205f91611c7884600754611e6b565b60075560446040518094819363a9059cbb60e01b835261dead60048401528760248401525af1908115611421575f91611cfb575b5015611cec576020906040518181527f15321e7b86c2f9808f06af272c8e7c2ae8ba0f557a4f13002d374dcc456bea60833392a260015f55604051908152f35b63f9820cc160e01b5f5260045ffd5b611d14915060203d6020116113f0576113e28183611e93565b82611cac565b9091506020813d602011611d46575b81611d3660209383611e93565b8101031261044257519082611c61565b3d9150611d29565b63085de62560e01b5f5260045ffd5b6371c12cb160e11b5f5260045ffd5b34610442575f36600319011261044257602060405162ffffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34610442575f36600319011261044257602060405161012c8152f35b34610442575f36600319011261044257602060405161dead8152f35b34610442575f366003190112610442578062278d0060209252f35b80516001600160a01b03908116835260208083015182169084015260408083015162ffffff169084015260608083015160020b9084015260809182015116910152565b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b9190820180921161144357565b60a081019081106001600160401b0382111761149357604052565b90601f801991011681019081106001600160401b0382111761149357604052565b90816020910312610442575190565b90816020910312610442575180151581036104425790565b5f6080604051611eea81611e78565b8281528260208201528260408201528260608201520152604051611f0d81611e78565b6001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811682527f00000000000000000000000000000000000000000000000000000000000000008116602083015262ffffff7f00000000000000000000000000000000000000000000000000000000000000001660408301527f000000000000000000000000000000000000000000000000000000000000000060020b60608301527f000000000000000000000000000000000000000000000000000000000000000016608082015290565b9081602091031261044257516001600160a01b03811681036104425790565b803b1561218f576001600160a01b03908116907f0000000000000000000000000000000000000000000000000000000000000000168103612207575b60405163f7c618c160e01b8152602081600481855afa5f91816121e6575b506120645750505f90565b6001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811691160361218f5760405163051ed6a360e41b8152602081600481855afa5f91816121b5575b506120bf5750505f90565b6001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811691160361218f57604051625f420d60e21b8152602081600481855afa5f9181612194575b506121195750505f90565b1561218f576020600491604051928380926318cbe5db60e11b82525afa5f918161215b575b5061214857505f90565b6201518042019081421161144357101590565b9091506020813d602011612187575b8161217760209383611e93565b810103126104425751905f61213e565b3d915061216a565b505f90565b6121ae91925060203d6020116113f0576113e28183611e93565b905f61210e565b6121d891925060203d6020116121df575b6121d08183611e93565b810190611fe0565b905f6120b4565b503d6121c6565b61220091925060203d6020116121df576121d08183611e93565b905f612059565b604051635b16ebb760e01b8152600481018290526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa5f9181612269575b506122605750505f90565b61203b57505f90565b61228391925060203d6020116113f0576113e28183611e93565b905f612255565b6001600160401b03811161149357601f01601f191660200190565b3d156122cf573d906122b68261228a565b916122c46040519384611e93565b82523d5f602084013e565b606090565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0381161561244d575f8060a0612310611edb565b206040516020810191637b995b2760e11b8352602482015260248152612337604482611e93565b5190845afa905f806123476122a5565b9260405160208101906358710f4560e11b825260048152612369602482611e93565b51915afa6123756122a5565b9215908115612444575b508015612439575b801561242e575b6124085760208151918180820193849201010312610442575160208251928180820194859201010312610442576123c6915190611e6b565b60638101809111611443577f0000000000000000000000000000000000000000000000000000000000000000906064900481811115612403575090565b905090565b50507f000000000000000000000000000000000000000000000000000000000000000090565b50602082511061238e565b506020815110612387565b9050155f61237f565b50606462ffffff61246160a06107a5611edb565b9250505016047f0000000000000000000000000000000000000000000000000000000000000000908181115f14612403575090565b61249e612633565b612518576001546001600160a01b0316156124e8576124bb6125c0565b7f000000000000000000000000000000000000000000000000000000000000000080821115612403575090565b6004547f000000000000000000000000000000000000000000000000000000000000000080821115612403575090565b5f90565b9190820391821161144357565b8181029291811591840414171561144357565b906125456122d4565b61271003916127108311611443576127106125666125809461257b93612529565b6001600160a01b039093169283919004612c59565b612c59565b7f00000000000000000000000000000000000000000000000000000000000000006127100390612710821161144357612710916125bc91612529565b0490565b6001546001600160a01b0316801561218f576020600491604051928380926318cbe5db60e11b82525afa5f91816125ff575b506125fc57505f90565b90565b9091506020813d60201161262b575b8161261b60209383611e93565b810103126104425751905f6125f2565b3d915061260e565b6001546001600160a01b03161515806126495790565b506126526125c0565b421090565b471561272b576001600160401b0360085460a01c166001600160401b036009541680155f1461270a57505f5b811580156126f6575b6126ed5761012c82019081831161144357808211156126e55750905b610e10810190818111611443578183116126d25750508042106126cd57506003904290565b600291565b610e110192915082106114435760019190565b9050906126a8565b50506001904290565b50610e10820180831161144357421161268c565b61025881018091111561268357634e487b7160e01b5f52601160045260245ffd5b5f905f90565b34156127635761274334600b54611e6b565b600b5560405134815260015f80516020612ca683398151915260203393a3565b565b341561251857337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161480156127fe575b156127d0576127af34600a54611e6b565b600a556040513481525f5f80516020612ca683398151915260203393a35f90565b6127dc34600c54611e6b565b600c5560405134815260035f80516020612ca683398151915260203393a35f90565b50337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03161461279e565b60025f541461283f5760025f55565b633ee5aeb560e01b5f5260045ffd5b6040516370a0823160e01b815230600482015291907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316905f90602085602481865afa948515611421575f95612a1a575b508415612a12576128ba85600654611e6b565b60065560405163095ea7b360e01b81526001600160a01b0382166004820152602481018690526020816044815f885af1908115611421575f916129f3575b5015611b3c576001600160a01b031691823b1561044257604051633c6b16ab60e01b8152600481018690525f8160248183885af18015611421576129dd575b50602060449160405192838092636eb1769f60e11b82523060048301528760248301525afa908115610c075782916129ab575b5061299c57507f15d76a0e45773d9864243be4bd453640dc148c17671c168aead15be4c774de6e6020604051858152a2565b63416aebb560e11b8152600490fd5b90506020813d6020116129d5575b816129c660209383611e93565b8101031261044257515f61296a565b3d91506129b9565b6129ea9192505f90611e93565b5f906020612937565b612a0c915060203d6020116113f0576113e28183611e93565b5f6128f8565b505f93505050565b9094506020813d602011612a46575b81612a3660209383611e93565b810103126104425751935f6128a7565b3d9150612a29565b91906020906040518281019182526006604082015260408152612a72606082611e93565b519020604051631e2eaeaf60e01b8152600481019190915292839060249082906001600160a01b03165afa918215611421575f92612ad3575b506001600160a01b0382169160a081901c60020b9162ffffff60b883901c81169260d01c1690565b9091506020813d602011612aff575b81612aef60209383611e93565b810103126104425751905f612aab565b3d9150612ae2565b90670de0b6b3a76400008202905f19670de0b6b3a7640000840992828085109403938085039414612ba65783821115612b9757670de0b6b3a7640000829109815f0382168092046002816003021880820260020302808202600203028082026002030280820260020302808202600203028091026002030293600183805f03040190848311900302920304170290565b63227bc15360e01b5f5260045ffd5b5091508115612bb3570490565b634e487b7160e01b5f52601260045260245ffd5b9190915f838202915f1985820991838084109303928084039314612c465782670de0b6b3a76400001115612c3757507faccb18165bd6fe31ae1cf318dc5b51eee0e1ba569b88cd74c1773b91fac106699394670de0b6b3a7640000910990828211900360ee1b910360121c170290565b63227bc15360e01b8152600490fd5b505050670de0b6b3a76400009192500490565b5f90828102925f1981830992848085109403938085039414612c9b57600160601b841015612c375750600160601b910990828211900360a01b910360601c1790565b5050505060601c9056fe191ba914d8a337423dc34b9fd86e797a16fe946bd7b7d014dc455b39307b6712a26469706673582212201c5366480ab0a21ca26dcef90639f3d5934784f3b2363a5cb2344e533c6ad65564736f6c634300081a0033" as `0x${string}`;

// constructor(Init) tuple, in order
export const BUYBACK_VAULT_ARGS = [{
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  polydash: "0x319525528f42167eF7fC18b77b889958080568e4",
  hook: "0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc",
  poolFee: 8388608,
  tickSpacing: 200,
  factoryA: "0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2",
  factoryB: "0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2",
  maxBuyEth: 20000000000000000n,
  maxSlippageBps: 300n,
  maxPoolFeeBps: 200n,
  burnShareBps: 6250n,
  stakingFactory: "0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0",
  targetAdmin: "0x9a21c75aC263cC43125E70200636f6397f8776d0",
  initialTarget: REWARDS_POOL_EXPECTED_ADDRESS, // pool deployed first at nonce 49
}] as const;

export const BUYBACK_LIMITS = {
  totalShareOfFeesBps: 4000, burnOfFeesBps: 2500, stakersOfFeesBps: 1500,
  burnShareOfVaultBps: 6250, stakersShareOfVaultBps: 3750,
  priceBandBps: 200, maxSlippageBps: 300, maxBuyEth: "0.02", cooldownMinutes: 10,
  observeDelayMinutes: 5, observeMaxAgeMinutes: 60, poolFeeBpsExpected: 120,
  targetTimelockHours: 48, noTargetBurnDays: 30, minTargetRemainingDays: 1,
} as const;

export const BUYBACK_FACTORY_MIN_ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "buybackEnabled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "buybackBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "buybackContract", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "setBuybackConfig", stateMutability: "nonpayable", inputs: [{ type: "bool", name: "enabled" }, { type: "uint256", name: "bps" }, { type: "address", name: "router" }], outputs: [] },
  { type: "function", name: "collectPlatformFeesMany", stateMutability: "nonpayable", inputs: [{ type: "address[]", name: "launches" }], outputs: [{ type: "uint256" }] },
  { type: "event", name: "PlatformFeesDistributed", inputs: [{ type: "address", name: "launch", indexed: true }, { type: "uint256", name: "total", indexed: false }, { type: "uint256", name: "toWallet", indexed: false }, { type: "uint256", name: "toBuyback", indexed: false }] },
  { type: "event", name: "BuybackConfigSet", inputs: [{ type: "bool", name: "enabled", indexed: false }, { type: "uint256", name: "bps", indexed: false }, { type: "address", name: "buybackContract", indexed: true }] },
  { type: "event", name: "BuybackFailed", inputs: [{ type: "uint256", name: "amount", indexed: false }] },
] as const;
