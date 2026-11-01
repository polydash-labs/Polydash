// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

interface IFeeWalletSource {
    function platformFeeWallet() external view returns (address);
}

/// @title PolypadGatedCollection (DRAFT - not deployed, not audited)
/// @notice Token-gated NFT collection with a floor vault.
///   1. Holder phase [holderStart, publicStart): a wallet holding at least `minBalance` of the gate token AT MINT
///      TIME may mint up to `holderMaxPerWallet` at `holderPrice`. The call must come directly from an EOA.
///      Limits: this is a balance check, not a snapshot. Tokens can be moved between wallets to mint again
///      (bounded by the per-wallet caps), and an EOA can buy, mint and sell in separate transactions.
///   2. Public phase [publicStart, ...): anyone mints at `publicPrice` up to `maxPerWallet` total per wallet
///      (holder mints count). publicPrice == 0 => holder-only.
///   Gate is optional: if publicStart == holderStart (factory holderDuration 0) there is no holder phase and
///   the collection is an ordinary open mint at publicPrice (gateToken is still recorded as the linked token).
///   3. Floor vault: `floorPerToken` (floorBps of the lower price) per NFT; any holder can burn for exactly that.
///   Creator proceeds and the platform fee are pulled; the fee wallet is read from the live PolypadNFTFactory.
contract PolypadGatedCollection is ERC721, ERC2981, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant BPS = 10_000;
    uint256 public constant PLATFORM_FEE_BPS = 20;
    uint256 public constant MAX_PER_WALLET_HARD = 100;

    struct Init {
        string name;
        string symbol;
        string imageUri;
        string description;
        string baseURI;
        uint256 maxSupply;
        uint256 holderPrice;
        uint256 publicPrice; // 0 => holder-only
        uint256 floorBps;
        uint96 royaltyBps;
        uint256 holderMaxPerWallet;
        uint256 maxPerWallet;
        address gateToken;
        uint256 minBalance;
        uint64 holderStart;
        uint64 publicStart;
        address creator;
        address payoutWallet;
        address feeSource;
    }

    address public immutable factory;
    address public immutable creator;
    address public immutable feeSource;
    IERC20 public immutable gateToken;
    uint256 public immutable minBalance;
    uint256 public immutable maxSupply;
    uint256 public immutable holderPrice;
    uint256 public immutable publicPrice;
    uint256 public immutable floorBps;
    uint256 public immutable floorPerToken;
    uint256 public immutable holderMaxPerWallet;
    uint256 public immutable maxPerWallet;
    uint64 public immutable holderStart;
    uint64 public immutable publicStart;
    uint96 public immutable royaltyBps;
    bool public immutable gated; // false => ungated open mint (no holder phase)

    string public imageUri;
    string public description;
    string private _base;
    address public payoutWallet;

    mapping(address => uint256) public holderMinted;
    mapping(address => uint256) public walletMinted;
    uint256 public totalMinted;
    uint256 public totalRedeemed;
    uint256 public creatorBalance;
    uint256 public platformBalance;
    bool public revealed;
    uint256 public metadataOffset;

    event Minted(address indexed user, uint256 qty, uint256 firstTokenId, bool holder, uint256 pricePaid);
    event Redeemed(address indexed user, uint256[] tokenIds, uint256 amount);
    event Revealed(uint256 offset);
    event BaseURIUpdated(string baseURI);
    event PayoutWalletUpdated(address wallet);
    event CreatorWithdrawn(address indexed to, uint256 amount);
    event PlatformWithdrawn(address indexed to, uint256 amount);

    error NotHolderPhase();
    error NotHolder();
    error NotEOA();
    error NotPublicPhase();
    error BadQuantity();
    error BadValue();
    error WalletLimit();
    error SoldOut();
    error NotOwner();
    error NotCreator();
    error ZeroAddress();
    error TransferFailed();
    error NothingToWithdraw();
    error Frozen();

    constructor(Init memory p) ERC721(p.name, p.symbol) {
        factory = msg.sender;
        creator = p.creator;
        feeSource = p.feeSource;
        gateToken = IERC20(p.gateToken);
        minBalance = p.minBalance;
        maxSupply = p.maxSupply;
        holderPrice = p.holderPrice;
        publicPrice = p.publicPrice;
        floorBps = p.floorBps;
        uint256 low = p.publicStart == p.holderStart ? p.publicPrice
            : (p.publicPrice != 0 && p.publicPrice < p.holderPrice) ? p.publicPrice : p.holderPrice;
        floorPerToken = (low * p.floorBps) / BPS;
        holderMaxPerWallet = p.holderMaxPerWallet;
        maxPerWallet = p.maxPerWallet;
        holderStart = p.holderStart;
        publicStart = p.publicStart;
        royaltyBps = p.royaltyBps;
        gated = p.publicStart > p.holderStart;
        imageUri = p.imageUri;
        description = p.description;
        _base = p.baseURI;
        payoutWallet = p.payoutWallet;
        _setDefaultRoyalty(p.payoutWallet, p.royaltyBps);
    }

    // ------------------------------------------------------------------ phases
    function phase() public view returns (uint8) {
        if (block.timestamp < holderStart) return 0; // not started
        if (block.timestamp < publicStart) return 1; // holder
        if (publicPrice == 0) return 3; // ended (holder-only)
        return 2; // public
    }

    // ------------------------------------------------------------------ holder phase
    /// @notice True if `user` holds at least `minBalance` gate tokens right now.
    function isHolder(address user) public view returns (bool) {
        return gated && gateToken.balanceOf(user) >= minBalance;
    }

    /// @notice Holder mint. The check is a balance check at mint time. Must be called directly by an EOA
    ///         (msg.sender == tx.origin) so a contract cannot borrow tokens and mint in the same transaction.
    function holderMint(uint256 qty) external payable nonReentrant {
        if (phase() != 1) revert NotHolderPhase();
        if (msg.sender != tx.origin) revert NotEOA();
        if (!isHolder(msg.sender)) revert NotHolder();
        if (qty == 0) revert BadQuantity();
        if (msg.value != qty * holderPrice) revert BadValue();
        uint256 h = holderMinted[msg.sender] + qty;
        if (h > holderMaxPerWallet) revert WalletLimit();
        uint256 w = walletMinted[msg.sender] + qty;
        if (w > maxPerWallet) revert WalletLimit();
        if (totalMinted + qty > maxSupply) revert SoldOut();
        holderMinted[msg.sender] = h;
        walletMinted[msg.sender] = w;
        _mintMany(msg.sender, qty, holderPrice, true);
    }

    // ------------------------------------------------------------------ public phase
    function mint(uint256 qty) external payable nonReentrant {
        if (phase() != 2) revert NotPublicPhase();
        if (qty == 0) revert BadQuantity();
        if (msg.value != qty * publicPrice) revert BadValue();
        uint256 w = walletMinted[msg.sender] + qty;
        if (w > maxPerWallet) revert WalletLimit();
        if (totalMinted + qty > maxSupply) revert SoldOut();
        walletMinted[msg.sender] = w;
        _mintMany(msg.sender, qty, publicPrice, false);
    }

    // ------------------------------------------------------------------ floor vault
    function redeem(uint256[] calldata tokenIds) external nonReentrant {
        uint256 n = tokenIds.length;
        if (n == 0) revert BadQuantity();
        for (uint256 i; i < n; ++i) {
            if (_ownerOf(tokenIds[i]) != msg.sender) revert NotOwner();
            _burn(tokenIds[i]);
        }
        totalRedeemed += n;
        uint256 amount = n * floorPerToken;
        emit Redeemed(msg.sender, tokenIds, amount);
        if (amount > 0) _send(msg.sender, amount);
    }

    // ------------------------------------------------------------------ payouts
    function withdrawCreator() external nonReentrant {
        uint256 a = creatorBalance;
        if (a == 0) revert NothingToWithdraw();
        creatorBalance = 0;
        emit CreatorWithdrawn(payoutWallet, a);
        _send(payoutWallet, a);
    }

    function withdrawPlatform() external nonReentrant {
        uint256 a = platformBalance;
        if (a == 0) revert NothingToWithdraw();
        platformBalance = 0;
        address to = IFeeWalletSource(feeSource).platformFeeWallet();
        emit PlatformWithdrawn(to, a);
        _send(to, a);
    }

    function setPayoutWallet(address w) external {
        if (msg.sender != creator) revert NotCreator();
        if (w == address(0)) revert ZeroAddress();
        payoutWallet = w;
        _setDefaultRoyalty(w, royaltyBps);
        emit PayoutWalletUpdated(w);
    }

    /// @notice Metadata can be fixed until the first mint; frozen after.
    function setBaseURI(string calldata b) external {
        if (msg.sender != creator) revert NotCreator();
        if (revealed) revert Frozen();
        if (bytes(b).length > 512) revert BadQuantity();
        _base = b;
        emit BaseURIUpdated(b);
    }

    // ------------------------------------------------------------------ views
    function baseURI() external view returns (string memory) { return _base; }
    function totalSupply() external view returns (uint256) { return totalMinted - totalRedeemed; }
    function floorReserve() external view returns (uint256) { return (totalMinted - totalRedeemed) * floorPerToken; }

    function metadataIndex(uint256 tokenId) public view returns (uint256) {
        return ((tokenId - 1 + metadataOffset) % maxSupply) + 1;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (bytes(_base).length == 0) return imageUri;
        return string.concat(_base, metadataIndex(tokenId).toString(), ".json");
    }

    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }

    // ------------------------------------------------------------------ internal
    function _mintMany(address to, uint256 n, uint256 price, bool holder) internal {
        if (!revealed) {
            revealed = true;
            metadataOffset = uint256(keccak256(abi.encode(block.prevrandao, blockhash(block.number - 1), address(this)))) % maxSupply;
            emit Revealed(metadataOffset);
        }
        uint256 fee = (price * PLATFORM_FEE_BPS) / BPS;
        uint256 id = totalMinted;
        totalMinted = id + n;
        platformBalance += n * fee;
        creatorBalance += n * (price - floorPerToken - fee);
        emit Minted(to, n, id + 1, holder, price);
        for (uint256 i = 1; i <= n; ++i) _mint(to, id + i);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
