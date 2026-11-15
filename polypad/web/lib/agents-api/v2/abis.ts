import { parseAbi } from 'viem';

export const launchAbi = parseAbi([
  'function token() view returns (address)',
  'function factory() view returns (address)',
  'function creator() view returns (address)',
  'function creatorFeeBps() view returns (uint256)',
  'function creatorPayoutWallet() view returns (address)',
  'function phase() view returns (uint8)',
  'function spotPrice() view returns (uint256)',
  'function realEthRaised() view returns (uint256)',
  'function graduationThreshold() view returns (uint256)',
  'function tokensSold() view returns (uint256)',
  'function curveSupply() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function virtualEth() view returns (uint256)',
  'function launchTime() view returns (uint256)',
  'function devBuyEth() view returns (uint256)',
  'function devBuyTokens() view returns (uint256)',
  'function totalCommitted() view returns (uint256)',
  'function committersLength() view returns (uint256)',
  'function currentBuyFeeBps() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function commitments(address) view returns (uint256)',
  'function quoteBuy(uint256 ethIn) view returns (uint256 tokensOut, (uint256 platform, uint256 creator, uint256 tax, uint256 total) fees)',
  'function quoteSell(uint256 tokensIn) view returns (uint256 ethOut, (uint256 platform, uint256 creator, uint256 tax, uint256 total) fees)',
  'function buy(uint256 minTokensOut) payable returns (uint256 tokensOut)',
  'function sell(uint256 tokensIn, uint256 minEthOut) returns (uint256 ethOut)',
  'function commit() payable',
  'event Bought(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 platformFee, uint256 creatorFee, uint256 price)',
  'event Sold(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 platformFee, uint256 creatorFee, uint256 price)',
  'event Graduated(address token, uint256 ethAdded, uint256 tokensAdded, uint256 tokensBurned, bytes32 poolId, uint256 timestamp)',
]);

export const launchFactoryAbi = parseAbi([
  'function allLaunchesLength() view returns (uint256)',
  'function allLaunches(uint256) view returns (address)',
  'function isLaunch(address) view returns (bool)',
  'function launchOfToken(address token) view returns (address launch)',
  'function PLATFORM_FEE_BPS() view returns (uint256)',
  'event LaunchCreated(address indexed launch, address indexed token, address indexed creator, string name, string symbol, string imageUri, uint256 creatorFeeBps, address creatorPayoutWallet)',
]);

export const hookAbi = parseAbi([
  'function computePoolId(address token) view returns (bytes32)',
  'function TICK_SPACING() view returns (int24)',
  'function LP_FEE() view returns (uint24)',
]);

export const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function imageUri() view returns (string)',
  'function description() view returns (string)',
  'function socialLinks() view returns (string[])',
]);

export const permit2Abi = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);

export const universalRouterAbi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);

export const v4QuoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

export const stateViewAbi = parseAbi(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)']);

export const poolKeyParam = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const;

export const nftFactoryAbi = parseAbi([
  'function allCollectionsLength() view returns (uint256)',
  'function allCollections(uint256) view returns (address)',
  'function isCollection(address) view returns (bool)',
]);

/** Commitment-window / fixed-price collections (PolypadNFTFactory clones). Selectors checked against deployed bytecode. */
export const nftCollectionAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function creator() view returns (address)',
  'function imageUri() view returns (string)',
  'function mintPrice() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function commitEnd() view returns (uint256)',
  'function totalCommitted() view returns (uint256)',
  'function publicAvailable() view returns (uint256)',
  'function maxPerWallet() view returns (uint256)',
  'function walletMinted(address) view returns (uint256)',
  'function royaltyBps() view returns (uint256)',
  'function floorBps() view returns (uint256)',
  'function floorReserve() view returns (uint256)',
  'function floorPerToken() view returns (uint256)',
  'function committed(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function commit(uint256 qty) payable',
  'function mint(uint256 qty) payable',
  'function claim()',
  'function redeem(uint256[] ids)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

export const nftMarketAbi = parseAbi([
  'function nextListingId() view returns (uint256)',
  'function listings(uint256) view returns (address seller, address nft, uint256 tokenId, uint256 price, uint64 expiry)',
  'function isListingValid(uint256) view returns (bool)',
  'function PLATFORM_FEE_BPS() view returns (uint256)',
  'function royaltyFor(address nft, uint256 tokenId, uint256 price) view returns (address receiver, uint256 amount)',
  'function buy(uint256 listingId) payable',
  'function buyMany(uint256[] listingIds) payable',
]);

export const fundFactoryAbi = parseAbi([
  'function allFundsLength() view returns (uint256)',
  'function allFunds(uint256) view returns (address)',
  'function isFund(address) view returns (bool)',
  'function templates() view returns (address)',
  'function PROTOCOL_FEE_BPS() view returns (uint256)',
  'function MAX_ENTRY_FEE_BPS() view returns (uint256)',
  'function MIN_MINT_PRICE() view returns (uint256)',
  'function MAX_MINT_PRICE() view returns (uint256)',
  'function MAX_SUPPLY() view returns (uint256)',
  'function MIN_RAISE_DURATION() view returns (uint256)',
  'function MAX_RAISE_DURATION() view returns (uint256)',
  'function DEFAULT_MIN_SKIN_BPS() view returns (uint256)',
  'event FundCreated(address indexed fund, address indexed vault, address indexed manager, uint256 templateId, uint256 maxSupply)',
]);

export const createFundAbi = [
  {
    type: 'function',
    name: 'createFund',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        components: [
          { name: 'templateId', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'imageUri', type: 'string' },
          { name: 'baseURI', type: 'string' },
          { name: 'mintPrice', type: 'uint256' },
          { name: 'raiseCap', type: 'uint256' },
          { name: 'entryFeeBps', type: 'uint256' },
          { name: 'minSkinBps', type: 'uint256' },
          { name: 'raiseDuration', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'fund', type: 'address' }],
  },
] as const;

export const templatesAbi = parseAbi([
  'function templateCount() view returns (uint256)',
  'function getTemplate(uint256 id) view returns (bytes32 mandateHash, string mandateUri, uint256 maxPositionBps, uint256 maxTradeBps, uint256 maxDeviationBps, uint256 hwmFeeBps, uint256 maxDrawdownBps, uint64 skinLock)',
  'function assetsOf(uint256 id) view returns (address[])',
]);

/** The fund share NFT. Present on Phase 1a through Phase 6 funds. Read functions are wrapped in allowFailure. */
export const fundNftAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function manager() view returns (address)',
  'function vault() view returns (address)',
  'function mintPrice() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function totalBurned() view returns (uint256)',
  'function entryFeeBps() view returns (uint256)',
  'function protocolFeeBps() view returns (uint256)',
  'function skinRequired() view returns (uint256)',
  'function managerMinted() view returns (uint256)',
  'function publicOpen() view returns (bool)',
  'function imageUri() view returns (string)',
  'function navPerNft() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function ownershipBps(address) view returns (uint256)',
  'function mint(uint256 qty) payable',
  'function exit(uint256[] ids)',
  'function refund(uint256[] ids)',
  'event Minted(address indexed minter, uint256 qty, uint256 firstTokenId, uint256 paid)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

export const fundVaultAbi = parseAbi([
  'function status() view returns (uint8)',
  'function raiseDeadline() view returns (uint64)',
  'function templateId() view returns (uint256)',
  'function nav() view returns (uint256)',
  'function navPerNft() view returns (uint256)',
  'function spendableEth() view returns (uint256)',
  'function mandateAssetCount() view returns (uint256)',
  'function mandateAssets(uint256) view returns (address)',
  'function protectionBits() view returns (uint8 bits, uint8 met, uint8 total)',
  'function mandateUri() view returns (string)',
  'function swapsPaused() view returns (bool)',
]);

export const stakingFactoryAbi = parseAbi([
  'function poolsLength() view returns (uint256)',
  'function poolsByCreator(address creator) view returns (address[])',
  'function getPoolInfo(address pool) view returns ((address pool, address creator, address stakeToken, address rewardToken, string name, string description, uint256 startTime, uint256 endTime, uint256 totalRewards, uint256 rewardRate, uint256 totalStaked, uint256 maxTotalStake, uint256 stakerCount, uint256 claimFeeBps, bool verified) info)',
]);
export const vestingFactoryAbi = parseAbi(['function totalLockedForToken(address token) view returns (uint256)']);
export const bondFactoryAbi = parseAbi(['function bondsByToken(address token) view returns (address[])']);
