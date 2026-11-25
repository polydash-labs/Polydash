import { parseAbi } from 'viem';

export const NFT_FACTORY_DEPLOY_BLOCK = BigInt(100986282);
const DEFAULT_NFT_FACTORY = '0x297c232F2EBCbB4e3Cd0b97167a971fF795EDdDd';

export function getNftFactoryAddress(): `0x${string}` {
  const a = process.env.NEXT_PUBLIC_NFT_FACTORY_ADDRESS;
  return (a && /^0x[0-9a-fA-F]{40}$/.test(a) ? a : DEFAULT_NFT_FACTORY) as `0x${string}`;
}

export const NftFactoryABI = parseAbi([
  'struct CollectionParams { string name; string symbol; string imageUri; string description; string baseURI; uint256 maxSupply; uint256 mintPrice; uint256 floorBps; uint96 royaltyBps; uint256 maxPerWallet; uint256 commitWindow; address payoutWallet; }',
  'function createCollection(CollectionParams p) returns (address)',
  'function allCollections(uint256) view returns (address)',
  'function allCollectionsLength() view returns (uint256)',
  'function collectionsOf(address creator) view returns (address[])',
  'function isCollection(address) view returns (bool)',
  'event CollectionCreated(address indexed collection, address indexed creator, string name, string symbol, uint256 maxSupply, uint256 mintPrice, uint256 floorBps, uint256 commitEnd)',
  'error InvalidParam(string field)',
]);

export const NftCollectionABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function imageUri() view returns (string)',
  'function description() view returns (string)',
  'function baseURI() view returns (string)',
  'function creator() view returns (address)',
  'function payoutWallet() view returns (address)',
  'function maxSupply() view returns (uint256)',
  'function mintPrice() view returns (uint256)',
  'function floorBps() view returns (uint256)',
  'function floorPerToken() view returns (uint256)',
  'function maxPerWallet() view returns (uint256)',
  'function commitEnd() view returns (uint256)',
  'function royaltyBps() view returns (uint96)',
  'function totalCommitted() view returns (uint256)',
  'function committerCount() view returns (uint256)',
  'function claimedCommitters() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function totalRedeemed() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function floorReserve() view returns (uint256)',
  'function publicAvailable() view returns (uint256)',
  'function creatorBalance() view returns (uint256)',
  'function committed(address) view returns (uint256)',
  'function claimed(address) view returns (bool)',
  'function allocationOf(address) view returns (uint256)',
  'function walletMinted(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function tokenURI(uint256) view returns (string)',
  'function metadataIndex(uint256) view returns (uint256)',
  'function commit(uint256 qty) payable',
  'function withdrawCommit(uint256 qty)',
  'function claim()',
  'function mint(uint256 qty) payable',
  'function redeem(uint256[] tokenIds)',
  'function withdrawCreator()',
  'function setBaseURI(string b)',
  'function setPayoutWallet(address w)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'error WindowClosed()',
  'error WindowOpen()',
  'error BadQuantity()',
  'error BadValue()',
  'error WalletLimit()',
  'error NothingCommitted()',
  'error AlreadyClaimed()',
  'error SoldOut()',
  'error NotOwner()',
  'error NotCreator()',
  'error ZeroAddress()',
  'error TransferFailed()',
  'error NothingToWithdraw()',
]);
