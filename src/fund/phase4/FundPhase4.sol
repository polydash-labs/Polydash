// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FundFactoryPhase3} from "../phase3/FundFactoryPhase3.sol";
import {FundShareAccount} from "./FundShareAccount.sol";

interface IERC6551Registry {
    function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        returns (address account);

    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address account);
}

interface IPhase3Vault {
    function manager() external view returns (address);
    function nft() external view returns (address);
    function templateId() external view returns (uint256);
    function isExecutor(address who) external view returns (bool);
    function nav() external view returns (uint256);
    function navPerNft() external view returns (uint256);
    function hwmPerNft() external view returns (uint256);
    function peakNavPerNft() external view returns (uint256);
    function tradeCount() external view returns (uint256);
    function status() external view returns (uint8);
    function swap(address router, address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external;
}

interface IPhase3Share {
    function vault() external view returns (address);
    function navPerNft() external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// @title FundPhase4
/// @notice Add-on for live Phase 3 funds. It does not replace `FundFactoryPhase3` and it does not
///         change a vault, a facet, or a template. The NFT remains the ownership claim.
///         Clone planning returns a call the user must send themselves: this contract does not
///         create the fund, because the factory records `msg.sender` as the manager.
///         An agent can swap only while a manager-set grant is active, unexpired, and this contract
///         is still an executor on that vault. The agent cannot pull fees, distribute, or move the NFT.
///         A season card stores readings. It is not a promise of a result.
///         A NAV bid escrows the bidder's ETH only. Settlement is not a vault exit.
///         Share accounts use the canonical ERC-6551 registry when that registry has code.
///         Not audited. Not a review. Not financial advice.
contract FundPhase4 is ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    /// @dev Same bounds as the live `FundFactoryPhase3`. A planned clone that misses them reverts here.
    uint256 public constant MIN_MINT_PRICE = 0.00001 ether;
    uint256 public constant MAX_MINT_PRICE = 100 ether;
    uint256 public constant MAX_ENTRY_FEE_BPS = 500;
    uint256 public constant MIN_RAISE_DURATION = 1 hours;
    uint256 public constant MAX_RAISE_DURATION = 30 days;
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant DEFAULT_MIN_SKIN_BPS = 500;
    uint64 public constant MAX_AGENT_WINDOW = 30 days;
    uint64 public constant MIN_SEASON = 1 days;
    uint64 public constant MAX_BID_WINDOW = 30 days;
    uint256 public constant MIN_BID = 0.00001 ether;
    uint8 public constant STATUS_INVESTING = 2;
    /// @notice Canonical ERC-6551 registry. This contract does not deploy a registry.
    address public constant ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    bytes32 public constant SHARE_SALT = bytes32(0);

    struct Cosmetic {
        string name;
        string symbol;
        string imageUri;
        string baseURI;
        uint256 mintPrice;
        uint256 raiseCap;
        uint256 entryFeeBps;
        uint256 minSkinBps;
        uint256 raiseDuration;
    }

    struct Grant {
        address agent;
        uint64 expiry;
        uint256 maxAmountIn;
        bool active;
    }

    struct Season {
        uint64 openedAt;
        uint64 closedAt;
        uint256 navStart;
        uint256 navEnd;
        uint256 hwmAtClose;
        uint256 peakPerShare;
        uint256 maxDrawdownBps;
        uint256 tradeStart;
        uint256 tradeEnd;
        int256 versusStartBps;
        int256 versusHwmBps;
        bool closed;
    }

    struct LiveCard {
        uint256 navTotal;
        uint256 navPerShare;
        uint256 hwmPerShare;
        uint256 peakPerShare;
        uint256 drawdownBps;
        uint256 tradeCount;
        uint8 status;
    }

    struct Bid {
        address bidder;
        address nft;
        uint256 tokenId;
        uint256 amount;
        uint64 expiry;
    }

    FundFactoryPhase3 public immutable factory;
    address public immutable weth;
    address public immutable shareAccount;

    mapping(address vault => Grant) public grants;
    mapping(address nft => Season[]) internal _seasons;
    mapping(address nft => bool) public seasonOpen;
    mapping(uint256 id => Bid) public bids;
    uint256 public bidCount;
    uint256 public escrowed;

    event AgentArmed(address indexed nft, address indexed vault, address indexed agent, uint64 expiry, uint256 maxAmountIn);
    event AgentRevoked(address indexed nft, address indexed vault, address indexed agent);
    event SeasonOpened(address indexed nft, uint256 indexed index, uint256 navPerShare, uint256 tradeCount);
    event SeasonPoked(address indexed nft, uint256 indexed index, uint256 navPerShare, uint256 maxDrawdownBps);
    event SeasonClosed(
        address indexed nft,
        uint256 indexed index,
        uint256 navPerShare,
        int256 versusStartBps,
        int256 versusHwmBps,
        uint256 maxDrawdownBps,
        uint256 trades
    );
    event BidPlaced(uint256 indexed id, address indexed nft, uint256 indexed tokenId, address bidder, uint256 amount, uint64 expiry);
    event BidSettled(uint256 indexed id, address indexed seller, address indexed bidder, uint256 amount);
    event BidCancelled(uint256 indexed id, address indexed bidder, uint256 amount);
    event ShareAccountCreated(address indexed nft, uint256 indexed tokenId, address indexed account);

    error BadFactory();
    error NotFund();
    error InvalidParams();
    error NotManager();
    error GateNotExecutor();
    error BadAgent();
    error BadExpiry();
    error NotAgent();
    error AmountCap();
    error NoGrant();
    error NotExpired();
    error NotInvesting();
    error SeasonState();
    error TooEarly();
    error BadIndex();
    error BidSmall();
    error AboveNav();
    error NoBid();
    error Expired();
    error NotHolder();
    error SelfBid();
    error WalletLoop();
    error PayFailed();
    error NotBidder();
    error DirectEth();
    error RegistryAbsent();

    constructor(address phase3Factory) {
        if (phase3Factory == address(0) || phase3Factory.code.length == 0) revert BadFactory();
        factory = FundFactoryPhase3(phase3Factory);
        weth = factory.weth();
        if (weth == address(0)) revert BadFactory();
        shareAccount = address(new FundShareAccount(phase3Factory));
    }

    /// @dev Bare transfers are rejected. Bid ETH arrives through `placeBid`.
    receive() external payable {
        revert DirectEth();
    }

    // ---------------------------------------------------------------------
    // Clone-a-mandate. The returned call is what the user signs. One transaction
    // to the live factory. This contract is not the manager.
    // ---------------------------------------------------------------------

    function cloneFromFund(address sourceFund, Cosmetic calldata cosmetic)
        external
        view
        returns (address target, bytes memory data)
    {
        uint256 templateId = IPhase3Vault(_vault(sourceFund)).templateId();
        return _plan(templateId, cosmetic);
    }

    function cloneFromTemplate(uint256 templateId, Cosmetic calldata cosmetic)
        external
        view
        returns (address target, bytes memory data)
    {
        return _plan(templateId, cosmetic);
    }

    function _plan(uint256 templateId, Cosmetic calldata cosmetic) internal view returns (address target, bytes memory data) {
        (bytes32 mandateHash,,,,,,,) = factory.templates().getTemplate(templateId);
        if (mandateHash == bytes32(0)) revert InvalidParams();
        _checkCosmetic(cosmetic);
        FundFactoryPhase3.Params memory params = FundFactoryPhase3.Params({
            templateId: templateId,
            name: cosmetic.name,
            symbol: cosmetic.symbol,
            imageUri: cosmetic.imageUri,
            baseURI: cosmetic.baseURI,
            mintPrice: cosmetic.mintPrice,
            raiseCap: cosmetic.raiseCap,
            entryFeeBps: cosmetic.entryFeeBps,
            minSkinBps: cosmetic.minSkinBps,
            raiseDuration: cosmetic.raiseDuration
        });
        target = address(factory);
        data = abi.encodeCall(FundFactoryPhase3.createFund, (params));
    }

    function _checkCosmetic(Cosmetic calldata cosmetic) internal pure {
        uint256 nameLen = bytes(cosmetic.name).length;
        uint256 symbolLen = bytes(cosmetic.symbol).length;
        if (nameLen == 0 || nameLen > 64 || symbolLen == 0 || symbolLen > 16) revert InvalidParams();
        if (bytes(cosmetic.imageUri).length > 512 || bytes(cosmetic.baseURI).length > 512) revert InvalidParams();
        if (cosmetic.mintPrice < MIN_MINT_PRICE || cosmetic.mintPrice > MAX_MINT_PRICE) revert InvalidParams();
        if (cosmetic.raiseCap < cosmetic.mintPrice || cosmetic.entryFeeBps > MAX_ENTRY_FEE_BPS) revert InvalidParams();
        if (cosmetic.raiseDuration < MIN_RAISE_DURATION || cosmetic.raiseDuration > MAX_RAISE_DURATION) revert InvalidParams();
        uint256 maxSupply = cosmetic.raiseCap / cosmetic.mintPrice;
        if (maxSupply == 0 || maxSupply > MAX_SUPPLY) revert InvalidParams();
        uint256 skinBps = cosmetic.minSkinBps == 0 ? DEFAULT_MIN_SKIN_BPS : cosmetic.minSkinBps;
        if (skinBps < DEFAULT_MIN_SKIN_BPS || skinBps > BPS) revert InvalidParams();
    }

    // ---------------------------------------------------------------------
    // Agent. The manager calls `setExecutor` on the vault with this contract, then `arm`.
    // Revoke here stops the agent in the same transaction. The vault flag
    // is cleared only by the manager, because the vault checks `msg.sender`.
    // ---------------------------------------------------------------------

    function arm(address nft, address agent, uint64 expiry, uint256 maxAmountIn) external {
        address vault = _vault(nft);
        if (IPhase3Vault(vault).manager() != msg.sender) revert NotManager();
        if (!IPhase3Vault(vault).isExecutor(address(this))) revert GateNotExecutor();
        if (agent == address(0) || agent == msg.sender || agent == address(this) || agent == vault || agent == nft) {
            revert BadAgent();
        }
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_AGENT_WINDOW) revert BadExpiry();
        grants[vault] = Grant({agent: agent, expiry: expiry, maxAmountIn: maxAmountIn, active: true});
        emit AgentArmed(nft, vault, agent, expiry, maxAmountIn);
    }

    function revoke(address nft) external {
        address vault = _vault(nft);
        if (IPhase3Vault(vault).manager() != msg.sender) revert NotManager();
        Grant memory g = grants[vault];
        if (!g.active) revert NoGrant();
        delete grants[vault];
        emit AgentRevoked(nft, vault, g.agent);
    }

    /// @notice After expiry, any address may clear the grant so the key cannot swap.
    function kick(address nft) external {
        address vault = _vault(nft);
        Grant memory g = grants[vault];
        if (!g.active || block.timestamp <= g.expiry) revert NotExpired();
        delete grants[vault];
        emit AgentRevoked(nft, vault, g.agent);
    }

    function agentOf(address nft) external view returns (address agent, uint64 expiry, uint256 maxAmountIn, bool active, bool gateIsExecutor) {
        address vault = _vault(nft);
        Grant memory g = grants[vault];
        return (g.agent, g.expiry, g.maxAmountIn, g.active, IPhase3Vault(vault).isExecutor(address(this)));
    }

    /// @notice Forward one swap to the fund vault. No `msg.value`. No other vault call.
    function agentSwap(
        address nft,
        address router,
        address assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external nonReentrant {
        address vault = _vault(nft);
        Grant memory g = grants[vault];
        if (!g.active || msg.sender != g.agent || block.timestamp > g.expiry) revert NotAgent();
        if (g.maxAmountIn != 0 && amountIn > g.maxAmountIn) revert AmountCap();
        IPhase3Vault(vault).swap(router, assetIn, assetOut, amountIn, minAmountOut, data);
    }

    // ---------------------------------------------------------------------
    // Seasons. Readings of net value per share. `maxDrawdownBps` is the worst
    // reading at open, poke, or close. It is not a continuous path.
    // ---------------------------------------------------------------------

    function openSeason(address nft) external nonReentrant returns (uint256 index) {
        address vault = _vault(nft);
        if (IPhase3Vault(vault).status() != STATUS_INVESTING) revert NotInvesting();
        if (seasonOpen[nft]) revert SeasonState();
        uint256 perShare = IPhase3Vault(vault).navPerNft();
        uint256 trades = IPhase3Vault(vault).tradeCount();
        Season memory row;
        row.openedAt = uint64(block.timestamp);
        row.navStart = perShare;
        row.peakPerShare = perShare;
        row.tradeStart = trades;
        _seasons[nft].push(row);
        seasonOpen[nft] = true;
        index = _seasons[nft].length - 1;
        emit SeasonOpened(nft, index, perShare, trades);
    }

    function pokeSeason(address nft) external nonReentrant {
        address vault = _vault(nft);
        if (!seasonOpen[nft]) revert SeasonState();
        uint256 index = _seasons[nft].length - 1;
        uint256 perShare = IPhase3Vault(vault).navPerNft();
        Season storage row = _seasons[nft][index];
        if (perShare > row.peakPerShare) row.peakPerShare = perShare;
        uint256 drop = _drawdown(row.peakPerShare, perShare);
        if (drop > row.maxDrawdownBps) row.maxDrawdownBps = drop;
        emit SeasonPoked(nft, index, perShare, row.maxDrawdownBps);
    }

    function closeSeason(address nft) external nonReentrant {
        address vault = _vault(nft);
        if (!seasonOpen[nft]) revert SeasonState();
        uint256 index = _seasons[nft].length - 1;
        Season storage row = _seasons[nft][index];
        if (block.timestamp < uint256(row.openedAt) + MIN_SEASON) revert TooEarly();
        uint256 perShare = IPhase3Vault(vault).navPerNft();
        uint256 hwm = IPhase3Vault(vault).hwmPerNft();
        uint256 trades = IPhase3Vault(vault).tradeCount();
        if (perShare > row.peakPerShare) row.peakPerShare = perShare;
        uint256 drop = _drawdown(row.peakPerShare, perShare);
        if (drop > row.maxDrawdownBps) row.maxDrawdownBps = drop;
        row.closedAt = uint64(block.timestamp);
        row.navEnd = perShare;
        row.hwmAtClose = hwm;
        row.tradeEnd = trades;
        row.versusStartBps = returnBps(perShare, row.navStart);
        row.versusHwmBps = returnBps(perShare, hwm);
        row.closed = true;
        seasonOpen[nft] = false;
        emit SeasonClosed(nft, index, perShare, row.versusStartBps, row.versusHwmBps, row.maxDrawdownBps, trades - row.tradeStart);
    }

    function seasonCount(address nft) external view returns (uint256) {
        return _seasons[nft].length;
    }

    function seasonOf(address nft, uint256 index) external view returns (Season memory) {
        if (index >= _seasons[nft].length) revert BadIndex();
        return _seasons[nft][index];
    }

    function liveCard(address nft) external view returns (LiveCard memory card) {
        address vault = _vault(nft);
        IPhase3Vault book = IPhase3Vault(vault);
        uint256 peak = book.peakNavPerNft();
        uint256 perShare = book.navPerNft();
        card = LiveCard({
            navTotal: book.nav(),
            navPerShare: perShare,
            hwmPerShare: book.hwmPerNft(),
            peakPerShare: peak,
            drawdownBps: _drawdown(peak, perShare),
            tradeCount: book.tradeCount(),
            status: book.status()
        });
    }

    /// @notice Change from `start` to `end`, in basis points. Zero when `start` is zero.
    ///         Positive means `end` is higher. This is arithmetic on the stored readings.
    function returnBps(uint256 end, uint256 start) public pure returns (int256) {
        if (start == 0) return 0;
        if (end >= start) {
            uint256 delta = end - start;
            if (delta > type(uint256).max / BPS) return type(int256).max;
            uint256 up = (delta * BPS) / start;
            if (up > uint256(type(int256).max)) return type(int256).max;
            return int256(up);
        }
        uint256 drop = start - end;
        if (drop > type(uint256).max / BPS) return type(int256).min;
        uint256 down = (drop * BPS) / start;
        if (down > uint256(type(int256).max)) return type(int256).min;
        return -int256(down);
    }

    // ---------------------------------------------------------------------
    // NAV-floor bids. The bidder's ETH only. `amount` must be <= net value
    // per share at placement and again at settlement. Not a vault exit.
    // ---------------------------------------------------------------------

    function placeBid(address nft, uint256 tokenId, uint64 expiry) external payable nonReentrant returns (uint256 id) {
        _vault(nft);
        if (msg.value < MIN_BID) revert BidSmall();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_BID_WINDOW) revert BadExpiry();
        address holder = IPhase3Share(nft).ownerOf(tokenId);
        if (holder == msg.sender) revert SelfBid();
        uint256 nav = IPhase3Share(nft).navPerNft();
        if (msg.value > nav) revert AboveNav();
        if (_shareWallet(nft, tokenId) == msg.sender) revert WalletLoop();
        id = ++bidCount;
        bids[id] = Bid({bidder: msg.sender, nft: nft, tokenId: tokenId, amount: msg.value, expiry: expiry});
        escrowed += msg.value;
        emit BidPlaced(id, nft, tokenId, msg.sender, msg.value, expiry);
    }

    /// @notice Current holder accepts one open bid. ETH and the share move in this transaction.
    ///         The holder must have approved this contract for the share.
    function settleBid(uint256 id) external nonReentrant {
        Bid memory b = bids[id];
        if (b.bidder == address(0)) revert NoBid();
        if (block.timestamp > b.expiry) revert Expired();
        address holder = IPhase3Share(b.nft).ownerOf(b.tokenId);
        if (msg.sender != holder) revert NotHolder();
        if (holder == b.bidder) revert SelfBid();
        uint256 nav = IPhase3Share(b.nft).navPerNft();
        if (b.amount > nav) revert AboveNav();
        delete bids[id];
        escrowed -= b.amount;
        emit BidSettled(id, holder, b.bidder, b.amount);
        IPhase3Share(b.nft).transferFrom(holder, b.bidder, b.tokenId);
        (bool ok,) = holder.call{value: b.amount}("");
        if (!ok) revert PayFailed();
    }

    function cancelBid(uint256 id) external nonReentrant {
        Bid memory b = bids[id];
        if (b.bidder == address(0)) revert NoBid();
        bool expired = block.timestamp > b.expiry;
        if (msg.sender != b.bidder && !expired) revert NotBidder();
        delete bids[id];
        escrowed -= b.amount;
        emit BidCancelled(id, b.bidder, b.amount);
        (bool ok,) = b.bidder.call{value: b.amount}("");
        if (!ok) revert PayFailed();
    }

    function bidStatus(uint256 id) external view returns (bool open, bool expired, bool withinNav, uint256 navPerShare) {
        Bid memory b = bids[id];
        open = b.bidder != address(0);
        if (!open) return (false, false, false, 0);
        expired = block.timestamp > b.expiry;
        try IPhase3Share(b.nft).navPerNft() returns (uint256 nav) {
            navPerShare = nav;
            withinNav = b.amount <= nav;
        } catch {
            withinNav = false;
        }
    }

    // ---------------------------------------------------------------------
    // Per-share wallets. Disabled while the canonical registry has no code.
    // ---------------------------------------------------------------------

    function shareAccountsEnabled() public view returns (bool) {
        return ERC6551_REGISTRY.code.length > 0;
    }

    function shareWallet(address nft, uint256 tokenId) external view returns (address wallet, bool enabled) {
        _vault(nft);
        enabled = shareAccountsEnabled();
        if (!enabled) return (address(0), false);
        wallet = IERC6551Registry(ERC6551_REGISTRY).account(shareAccount, SHARE_SALT, block.chainid, nft, tokenId);
    }

    function createShareAccount(address nft, uint256 tokenId) external returns (address wallet) {
        if (!shareAccountsEnabled()) revert RegistryAbsent();
        _vault(nft);
        address holder = IPhase3Share(nft).ownerOf(tokenId);
        if (holder == address(0)) revert NotFund();
        emit ShareAccountCreated(nft, tokenId, _shareWallet(nft, tokenId));
        wallet = IERC6551Registry(ERC6551_REGISTRY).createAccount(shareAccount, SHARE_SALT, block.chainid, nft, tokenId);
    }

    function _shareWallet(address nft, uint256 tokenId) internal view returns (address) {
        if (!shareAccountsEnabled()) return address(0);
        return IERC6551Registry(ERC6551_REGISTRY).account(shareAccount, SHARE_SALT, block.chainid, nft, tokenId);
    }

    function _vault(address nft) internal view returns (address vault) {
        if (!factory.isFund(nft)) revert NotFund();
        vault = IPhase3Share(nft).vault();
        if (vault == address(0) || IPhase3Vault(vault).nft() != nft) revert NotFund();
    }

    function _drawdown(uint256 peak, uint256 current) internal pure returns (uint256) {
        if (peak == 0 || current >= peak) return 0;
        return ((peak - current) * BPS) / peak;
    }
}
