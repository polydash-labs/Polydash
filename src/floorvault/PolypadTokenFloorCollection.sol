// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {ILaunchInfo, IHookInfo, IFeeWalletSource} from "./Interfaces.sol";

/// @title PolypadTokenFloorCollection (DRAFT - not deployed, not audited)
/// @notice Fixed-price NFT collection linked to a Polypad launch token, with a two-asset floor vault.
///   On each mint `floorBps` of the price goes to the vault. `tokenShareBps` of that floor share is queued
///   (`pendingEth`) to buy the linked token; the rest stays ETH. Queued ETH is swapped in capped batches by
///   anyone calling `buyToken()` once the launch has graduated to its Uniswap V4 pool, under three limits:
///   a price observation at least OBS_DELAY old, spot within MAX_DEVIATION_BPS of it, and a minimum output
///   of the observed price minus `maxSlippageBps`. Burning NFTs pays a pro-rata share of the vault's ETH
///   (including queued ETH) and of the tokens it holds. The token part moves with the market and can go to zero.
///   No owner. The creator cannot withdraw vault funds.
contract PolypadTokenFloorCollection is ERC721, ERC2981, ReentrancyGuard, IUnlockCallback {
    using Strings for uint256;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 public constant BPS = 10_000;
    uint256 public constant PLATFORM_FEE_BPS = 20;
    uint256 public constant OBS_DELAY = 5 minutes;
    uint256 public constant OBS_MAX_AGE = 1 hours;
    uint256 public constant BUY_COOLDOWN = 10 minutes;
    uint256 public constant MAX_DEVIATION_BPS = 200;
    uint256 public constant GRADUATION_WINDOW = 180 days;
    uint256 public constant MAX_HOOK_FEE_BPS = 520; // 0.2% platform + up to 5% creator fee

    struct Init {
        string name;
        string symbol;
        string imageUri;
        string description;
        string baseURI;
        uint256 maxSupply;
        uint256 price;
        uint256 floorBps;
        uint256 tokenShareBps;
        uint256 maxSlippageBps;
        uint256 maxBuyEth;
        uint96 royaltyBps;
        uint256 maxPerWallet;
        uint64 startTime;
        address creator;
        address payoutWallet;
        address launch;
        address token;
        address feeSource;
        address poolManager;
    }

    bool private _initialized;
    address public factory;
    address public creator;
    address public payoutWallet;
    address public feeSource;
    address public launch;
    IERC20 public token;
    IPoolManager public poolManager;

    uint256 public maxSupply;
    uint256 public price;
    uint256 public floorBps;
    uint256 public tokenShareBps;
    uint256 public maxSlippageBps;
    uint256 public maxBuyEth;
    uint256 public maxPerWallet;
    uint64 public startTime;
    uint64 public createdAt;
    bool public tokenShareActive;

    string private _name;
    string private _symbol;
    string public imageUri;
    string public description;
    string private _base;

    uint256 public totalMinted;
    uint256 public totalRedeemed;
    mapping(address => uint256) public walletMinted;

    // vault
    uint256 public ethFloor; // ETH that stays ETH
    uint256 public pendingEth; // ETH queued to buy the token (paid out as ETH on burn until swapped)
    uint256 public tokenReserve; // tokens held for holders
    uint256 public totalEthSwapped;
    uint256 public totalTokensBought;
    mapping(address => uint256) public tokenOwed; // token transfers that failed at burn; claimable later

    // proceeds (pull)
    uint256 public creatorBalance;
    uint256 public platformBalance;

    // price observation for buys
    uint160 public obsSqrtPriceX96;
    uint64 public obsTime;
    uint64 public lastBuyTime;

    event Minted(address indexed to, uint256 qty, uint256 paid, uint256 toEthFloor, uint256 toPending);
    event Redeemed(address indexed holder, uint256 count, uint256 ethOut, uint256 tokenOut);
    event PriceObserved(uint160 sqrtPriceX96, uint256 at);
    event TokenBought(address indexed caller, uint256 ethIn, uint256 tokensOut);
    event TokenShareEnded(uint256 at);
    event TokenTransferFailed(address indexed holder, uint256 amount);

    error AlreadyInitialized();
    error NotStarted();
    error SoldOut();
    error WalletCap();
    error BadPayment();
    error NotOwnerOf(uint256 id);
    error NotCreator();
    error ZeroAddress();
    error Frozen();
    error NotGraduated();
    error NothingPending();
    error Cooldown();
    error NoFreshObservation();
    error PriceMoved();
    error ObservationNotDue();
    error Slippage();
    error NotPoolManager();
    error TooEarly();
    error Inactive();
    error TransferFailed();
    error Nothing();

    constructor() ERC721("", "") {
        _initialized = true; // lock the implementation
    }

    function initialize(Init calldata p) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        factory = msg.sender;
        _name = p.name;
        _symbol = p.symbol;
        imageUri = p.imageUri;
        description = p.description;
        _base = p.baseURI;
        maxSupply = p.maxSupply;
        price = p.price;
        floorBps = p.floorBps;
        tokenShareBps = p.tokenShareBps;
        maxSlippageBps = p.maxSlippageBps;
        maxBuyEth = p.maxBuyEth;
        maxPerWallet = p.maxPerWallet;
        startTime = p.startTime;
        createdAt = uint64(block.timestamp);
        creator = p.creator;
        payoutWallet = p.payoutWallet;
        launch = p.launch;
        token = IERC20(p.token);
        feeSource = p.feeSource;
        poolManager = IPoolManager(p.poolManager);
        tokenShareActive = true;
        _setDefaultRoyalty(p.payoutWallet, p.royaltyBps);
    }

    // ------------------------------------------------------------------ mint

    function mint(uint256 qty) external payable nonReentrant {
        if (block.timestamp < startTime) revert NotStarted();
        if (qty == 0 || totalMinted + qty > maxSupply) revert SoldOut();
        if (walletMinted[msg.sender] + qty > maxPerWallet) revert WalletCap();
        uint256 cost = price * qty;
        if (msg.value != cost) revert BadPayment();

        uint256 platformCut = (cost * PLATFORM_FEE_BPS) / BPS;
        uint256 floorCut = (cost * floorBps) / BPS;
        uint256 toPending = tokenShareActive ? (floorCut * tokenShareBps) / BPS : 0;
        uint256 toEth = floorCut - toPending;

        platformBalance += platformCut;
        creatorBalance += cost - platformCut - floorCut;
        ethFloor += toEth;
        pendingEth += toPending;

        uint256 first = totalMinted;
        totalMinted = first + qty;
        walletMinted[msg.sender] += qty;
        for (uint256 i; i < qty; ++i) {
            _safeMint(msg.sender, first + i);
        }
        emit Minted(msg.sender, qty, cost, toEth, toPending);
    }

    // ------------------------------------------------------------------ burn for vault share

    /// @notice Burn NFTs for a pro-rata share of the vault: ETH (incl. queued ETH) plus held tokens.
    function redeem(uint256[] calldata ids) external nonReentrant returns (uint256 ethOut, uint256 tokenOut) {
        uint256 n = ids.length;
        if (n == 0) revert Nothing();
        uint256 live = totalMinted - totalRedeemed;
        for (uint256 i; i < n; ++i) {
            if (ownerOf(ids[i]) != msg.sender) revert NotOwnerOf(ids[i]);
            _burn(ids[i]);
        }
        uint256 fromEth = Math.mulDiv(ethFloor, n, live);
        uint256 fromPending = Math.mulDiv(pendingEth, n, live);
        tokenOut = Math.mulDiv(tokenReserve, n, live);
        ethFloor -= fromEth;
        pendingEth -= fromPending;
        tokenReserve -= tokenOut;
        totalRedeemed += n;
        ethOut = fromEth + fromPending;

        if (tokenOut > 0 && !_tryTransferToken(msg.sender, tokenOut)) {
            tokenOwed[msg.sender] += tokenOut;
            emit TokenTransferFailed(msg.sender, tokenOut);
        }
        emit Redeemed(msg.sender, n, ethOut, tokenOut);
        if (ethOut > 0) _sendEth(msg.sender, ethOut);
    }

    /// @notice Retry a token payout that failed at burn (e.g. token paused).
    function claimOwedToken() external nonReentrant {
        uint256 a = tokenOwed[msg.sender];
        if (a == 0) revert Nothing();
        tokenOwed[msg.sender] = 0;
        if (!_tryTransferToken(msg.sender, a)) revert TransferFailed();
    }

    // ------------------------------------------------------------------ token buys (anyone)

    /// @notice Record the pool's spot price. Allowed when there is no observation or the last one expired.
    function observePrice() external nonReentrant {
        if (!ILaunchInfo(launch).graduated()) revert NotGraduated();
        if (obsTime != 0 && block.timestamp <= obsTime + OBS_MAX_AGE) revert ObservationNotDue();
        uint160 spot = _spot(_key());
        obsSqrtPriceX96 = spot;
        obsTime = uint64(block.timestamp);
        emit PriceObserved(spot, block.timestamp);
    }

    /// @notice Swap up to `maxBuyEth` of queued ETH for the token on the launch's V4 pool.
    function buyToken() external nonReentrant returns (uint256 ethIn, uint256 tokensOut) {
        if (!ILaunchInfo(launch).graduated()) revert NotGraduated();
        if (pendingEth == 0) revert NothingPending();
        if (lastBuyTime != 0 && block.timestamp < lastBuyTime + BUY_COOLDOWN) revert Cooldown();
        uint256 age = block.timestamp - obsTime;
        if (obsTime == 0 || age < OBS_DELAY || age > OBS_MAX_AGE) revert NoFreshObservation();

        PoolKey memory key = _key();
        uint160 ref = obsSqrtPriceX96;
        if (!_withinDeviation(_spot(key), ref)) revert PriceMoved();

        uint256 amount = pendingEth < maxBuyEth ? pendingEth : maxBuyEth;
        // buying token (zeroForOne) lowers sqrtPrice; stop at ref * sqrt(1 - slippage) ~= ref * (1 - slip/2)
        uint160 limit = uint160((uint256(ref) * (BPS - maxSlippageBps / 2)) / BPS);
        if (limit <= TickMath.MIN_SQRT_PRICE) limit = TickMath.MIN_SQRT_PRICE + 1;

        obsTime = 0; // each buy needs a new observation
        lastBuyTime = uint64(block.timestamp);

        (ethIn, tokensOut) = abi.decode(poolManager.unlock(abi.encode(key, amount, limit)), (uint256, uint256));
        uint256 netIn = (ethIn * (BPS - buyFeeBps())) / BPS; // the Polypad hook takes its buy fee from the ETH in
        if (ethIn == 0 || tokensOut < minTokensOut(netIn, ref)) revert Slippage();

        pendingEth -= ethIn;
        tokenReserve += tokensOut;
        totalEthSwapped += ethIn;
        totalTokensBought += tokensOut;
        emit TokenBought(msg.sender, ethIn, tokensOut);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolKey memory key, uint256 amount, uint160 limit) = abi.decode(data, (PoolKey, uint256, uint160));
        BalanceDelta d = poolManager.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: limit}),
            ""
        );
        int128 a0 = d.amount0();
        int128 a1 = d.amount1();
        uint256 ethOwed = a0 < 0 ? uint256(int256(-a0)) : 0;
        uint256 tokIn = a1 > 0 ? uint256(int256(a1)) : 0;
        if (ethOwed > 0) poolManager.settle{value: ethOwed}();
        uint256 before = token.balanceOf(address(this));
        if (tokIn > 0) poolManager.take(key.currency1, address(this), tokIn);
        uint256 received = token.balanceOf(address(this)) - before;
        return abi.encode(ethOwed, received);
    }

    /// @notice If the launch has not graduated within GRADUATION_WINDOW, anyone may end the token share.
    ///         Future mints then add only ETH. Queued ETH remains in the vault as ETH.
    function endTokenShare() external nonReentrant {
        if (!tokenShareActive) revert Inactive();
        if (ILaunchInfo(launch).graduated() || block.timestamp < createdAt + GRADUATION_WINDOW) revert TooEarly();
        tokenShareActive = false;
        ethFloor += pendingEth;
        pendingEth = 0;
        emit TokenShareEnded(block.timestamp);
    }

    // ------------------------------------------------------------------ proceeds

    function withdrawCreator() external nonReentrant {
        uint256 a = creatorBalance;
        if (a == 0) revert Nothing();
        creatorBalance = 0;
        _sendEth(payoutWallet, a);
    }

    function withdrawPlatform() external nonReentrant {
        uint256 a = platformBalance;
        if (a == 0) revert Nothing();
        platformBalance = 0;
        _sendEth(IFeeWalletSource(feeSource).platformFeeWallet(), a);
    }

    function setPayoutWallet(address w) external {
        if (msg.sender != creator) revert NotCreator();
        if (w == address(0)) revert ZeroAddress();
        payoutWallet = w;
        (, uint256 r) = royaltyInfo(0, BPS);
        _setDefaultRoyalty(w, uint96(r));
    }

    function setBaseURI(string calldata b) external {
        if (msg.sender != creator) revert NotCreator();
        if (totalMinted > 0) revert Frozen();
        _base = b;
    }

    // ------------------------------------------------------------------ views

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string.concat(_base, id.toString(), ".json");
    }

    function outstanding() public view returns (uint256) {
        return totalMinted - totalRedeemed;
    }

    /// @notice What burning one NFT pays right now (ETH incl. queued, token amount).
    function redeemValuePerNft() external view returns (uint256 ethPer, uint256 tokenPer) {
        uint256 o = outstanding();
        if (o == 0) return (0, 0);
        return ((ethFloor + pendingEth) / o, tokenReserve / o);
    }

    function graduated() external view returns (bool) {
        return ILaunchInfo(launch).graduated();
    }

    /// @notice Tokens expected for `ethIn` at `sqrtP` (token per ETH = sqrtP^2 / 2^192), minus maxSlippageBps.
    function minTokensOut(uint256 ethIn, uint160 sqrtP) public view returns (uint256) {
        uint256 q = Math.mulDiv(Math.mulDiv(ethIn, sqrtP, 1 << 96), sqrtP, 1 << 96);
        return (q * (BPS - maxSlippageBps)) / BPS;
    }

    /// @notice Buy-side fee the launch's hook charges on the ETH in (platform + creator), read from hook.pools(id).
    ///         Falls back to the maximum (0.2% + 5%) if the hook cannot be read.
    function buyFeeBps() public view returns (uint256) {
        PoolKey memory key = _key();
        (bool ok, bytes memory r) =
            address(key.hooks).staticcall(abi.encodeWithSignature("pools(bytes32)", PoolId.unwrap(key.toId())));
        if (!ok || r.length < 128) return MAX_HOOK_FEE_BPS;
        (, , uint256 platformBps, uint256 creatorBps) = abi.decode(r, (address, address, uint256, uint256));
        uint256 total = platformBps + creatorBps;
        return total > MAX_HOOK_FEE_BPS ? MAX_HOOK_FEE_BPS : total;
    }

    function spotSqrtPriceX96() external view returns (uint160) {
        return _spot(_key());
    }

    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }

    // ------------------------------------------------------------------ internal

    function _key() internal view returns (PoolKey memory) {
        return IHookInfo(ILaunchInfo(launch).hook()).poolKeyOf(launch);
    }

    function _spot(PoolKey memory key) internal view returns (uint160 s) {
        (s,,,) = poolManager.getSlot0(key.toId());
    }

    /// @dev price ratio (spot/ref)^2 within +-MAX_DEVIATION_BPS
    function _withinDeviation(uint160 spot, uint160 ref) internal pure returns (bool) {
        uint256 r = Math.mulDiv(spot, 1e18, ref);
        uint256 r2 = Math.mulDiv(r, r, 1e18);
        return r2 >= 1e18 * (BPS - MAX_DEVIATION_BPS) / BPS && r2 <= 1e18 * (BPS + MAX_DEVIATION_BPS) / BPS;
    }

    function _tryTransferToken(address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        return ok && (ret.length == 0 || abi.decode(ret, (bool)));
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert BadPayment();
    }
}
