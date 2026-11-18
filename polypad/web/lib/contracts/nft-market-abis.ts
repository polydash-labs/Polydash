import { parseAbi } from 'viem';

type Addr = `0x${string}`;
const isAddr = (a?: string): a is Addr => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);

// Phase 2 contracts are only used once their addresses are configured.
export function getNftMarketAddress(): Addr | null {
  const a = process.env.NEXT_PUBLIC_NFT_MARKET_ADDRESS;
  return isAddr(a) ? a : null;
}
export function getCurveFactoryAddress(): Addr | null {
  const a = process.env.NEXT_PUBLIC_NFT_CURVE_FACTORY_ADDRESS;
  return isAddr(a) ? a : null;
}
export function getTokenLinkAddress(): Addr | null {
  const a = process.env.NEXT_PUBLIC_NFT_TOKEN_LINK_ADDRESS;
  return isAddr(a) ? a : null;
}
/** Block the phase 2 contracts were deployed at (log scans start here). */
export function getPhase2DeployBlock(): bigint {
  const b = Number(process.env.NEXT_PUBLIC_NFT_PHASE2_DEPLOY_BLOCK);
  return BigInt(Number.isFinite(b) && b > 0 ? Math.floor(b) : 100986282);
}

export const NftMarketABI = parseAbi([
  'function list(address collection, uint256 tokenId, uint256 price, uint64 expiry) returns (uint256)',
  'function cancelListing(uint256 id)',
  'function buy(uint256 id) payable',
  'function buyMany(uint256[] ids) payable',
  'function makeOffer(address collection, uint256 tokenId, bool anyToken, uint64 expiry) payable returns (uint256)',
  'function cancelOffer(uint256 id)',
  'function acceptOffer(uint256 id, uint256 tokenId)',
  'function withdraw()',
  'function royaltyFor(address collection, uint256 tokenId, uint256 price) view returns (address receiver, uint256 amount)',
  'function isListingValid(uint256 id) view returns (bool)',
  'function listings(uint256) view returns (address seller, address collection, uint256 tokenId, uint256 price, uint64 expiry)',
  'function offers(uint256) view returns (address buyer, address collection, uint256 tokenId, bool anyToken, uint256 price, uint64 expiry)',
  'function listingOf(address, uint256) view returns (uint256)',
  'function pendingWithdrawals(address) view returns (uint256)',
  'event Listed(uint256 indexed listingId, address indexed collection, uint256 indexed tokenId, address seller, uint256 price, uint64 expiry)',
  'event ListingCancelled(uint256 indexed listingId, address indexed collection, uint256 indexed tokenId)',
  'event Sold(uint256 indexed listingId, address indexed collection, uint256 indexed tokenId, address seller, address buyer, uint256 price, uint256 royalty)',
  'event OfferMade(uint256 indexed offerId, address indexed collection, uint256 indexed tokenId, address buyer, bool anyToken, uint256 price, uint64 expiry)',
  'event OfferCancelled(uint256 indexed offerId, address indexed collection, address buyer)',
  'event OfferAccepted(uint256 indexed offerId, address indexed collection, uint256 indexed tokenId, address seller, address buyer, uint256 price, uint256 royalty)',
  'error NotOwner()',
  'error NotApproved()',
  'error BadPrice()',
  'error BadExpiry()',
  'error NotActive()',
  'error Expired()',
  'error BadValue()',
  'error NotSeller()',
  'error NotBuyer()',
  'error WrongToken()',
  'error NothingToWithdraw()',
  'error TransferFailed()',
  'error ZeroAddress()',
]);

export const Erc721ApprovalABI = parseAbi([
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
]);

export const Erc20ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export const CurveFactoryABI = parseAbi([
  'struct CurveParams { string name; string symbol; string imageUri; string description; string baseURI; uint256 maxSupply; uint256 startPrice; uint256 priceStep; uint256 creatorFeeBps; uint256 floorBps; uint96 royaltyBps; address payoutWallet; }',
  'function createCollection(CurveParams p) returns (address)',
  'function allCollections(uint256) view returns (address)',
  'function allCollectionsLength() view returns (uint256)',
  'function collectionsOf(address creator) view returns (address[])',
  'function isCollection(address) view returns (bool)',
  'event CurveCollectionCreated(address indexed collection, address indexed creator, string name, string symbol, uint256 maxSupply, uint256 startPrice, uint256 priceStep, uint256 floorBps)',
  'error InvalidParam(string field)',
]);

export const CurveCollectionABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function imageUri() view returns (string)',
  'function description() view returns (string)',
  'function baseURI() view returns (string)',
  'function creator() view returns (address)',
  'function payoutWallet() view returns (address)',
  'function maxSupply() view returns (uint256)',
  'function startPrice() view returns (uint256)',
  'function priceStep() view returns (uint256)',
  'function creatorFeeBps() view returns (uint256)',
  'function floorBps() view returns (uint256)',
  'function royaltyBps() view returns (uint96)',
  'function totalMinted() view returns (uint256)',
  'function totalRedeemed() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function reserve() view returns (uint256)',
  'function creatorBalance() view returns (uint256)',
  'function volume() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function floorPerToken() view returns (uint256)',
  'function floorVault() view returns (uint256)',
  'function circulating() view returns (uint256)',
  'function nextPrice() view returns (uint256)',
  'function poolSize() view returns (uint256)',
  'function poolTokens() view returns (uint256[])',
  'function curveSum(uint256 from, uint256 qty) view returns (uint256)',
  'function quoteBuy(uint256 qty) view returns (uint256 total, uint256 cost, uint256 fees)',
  'function quoteSell(uint256 qty) view returns (uint256 net, uint256 gross, uint256 fees)',
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function tokenURI(uint256) view returns (string)',
  'function buy(uint256 qty, uint256 maxTotal) payable returns (uint256[])',
  'function sell(uint256[] tokenIds, uint256 minNet) returns (uint256)',
  'function redeem(uint256[] tokenIds)',
  'function withdrawCreator()',
  'function setBaseURI(string b)',
  'function setPayoutWallet(address w)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event Bought(address indexed buyer, uint256[] tokenIds, uint256 cost, uint256 fees, uint256 circulating)',
  'event SoldToPool(address indexed seller, uint256[] tokenIds, uint256 proceeds, uint256 fees, uint256 circulating)',
  'error CurveClosed()',
  'error NotGraduated()',
  'error BadQuantity()',
  'error SoldOut()',
  'error Slippage()',
  'error NotOwner()',
  'error NotCreator()',
  'error ZeroAddress()',
  'error TransferFailed()',
  'error NothingToWithdraw()',
  'error Locked()',
]);

export const TokenLinkABI = parseAbi([
  'function createLink(address collection, address token, uint256 amountPerNft, uint64 claimDeadline) returns (uint256)',
  'function claim(uint256 id, uint256[] tokenIds) returns (uint256)',
  'function close(uint256 id)',
  'function links(uint256) view returns (address collection, address token, address creator, uint256 amountPerNft, uint256 deposited, uint256 claimed, uint64 claimDeadline, bool closed)',
  'function linksLength() view returns (uint256)',
  'function linksOfCollection(address c) view returns (uint256[])',
  'function linksOfToken(address t) view returns (uint256[])',
  'function unclaimed(uint256 id, uint256[] tokenIds) view returns (bool[])',
  'error NotCreator()',
  'error BadParam()',
  'error NotOwner()',
  'error AlreadyClaimed()',
  'error Closed()',
  'error TooEarly()',
  'error DepositMismatch()',
]);
