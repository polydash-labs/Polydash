// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IStakingFactoryInfo {
    function isPool(address pool) external view returns (bool);
}

/// @dev Views present on Polydash staking pools, plus the reward top-up entry point the target must expose.
interface IRewardsTarget {
    function stakeToken() external view returns (address);
    function rewardToken() external view returns (address);
    function endTime() external view returns (uint256);
    /// Pulls `amount` reward tokens from msg.sender (transferFrom) and schedules them for stakers.
    function notifyRewardAmount(uint256 amount) external;
    /// Must return true: marks a pool that accepts reward top-ups.
    function acceptsRewardTopUps() external view returns (bool);
}

interface IWETH9 {
    function deposit() external payable;
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title PolydashBuybackVault (not audited)
/// @notice Receives the buyback share of Polydash platform fees and uses it to buy POLYDASH on its
///   Uniswap V4 POLYDASH/WETH pool. Each buy splits its output: `burnShareBps` goes straight to 0x...dEaD in the
///   same transaction; the rest is held for POLYDASH stakers. Held POLYDASH can leave the vault only to the
///   rewards target (a verified POLYDASH staking pool that has not ended) via notifyRewardAmount, or, if there
///   has been no active target for NO_TARGET_BURN_DELAY, to 0x...dEaD.
///   The rewards target can only be changed by `targetAdmin` (the Polydash fee wallet) through a public
///   TARGET_TIMELOCK (48h) propose / cancel / execute flow. targetAdmin cannot move ETH or POLYDASH anywhere else.
///   ETH arrives from the launch factories' buyback hook (`buyback()`), from labelled manual top-ups
///   (`topUp()`), or as plain transfers. Receiving never reverts.
///   Buys are anyone-callable in two steps: `observePrice()` records the pool price, then `buy()` may run
///   between OBS_DELAY and OBS_MAX_AGE later, only if spot is within MAX_DEVIATION_BPS of the recorded price,
///   capped at `maxBuyEth`, at most once per BUY_COOLDOWN, with a minimum output derived from the recorded
///   price net of the pool's fees and `maxSlippageBps`.
///   No owner, no admin, no withdraw. All parameters are immutable.
contract PolydashBuybackVault is ReentrancyGuard, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 public constant BPS = 10_000;
    uint256 public constant OBS_DELAY = 5 minutes;
    uint256 public constant OBS_MAX_AGE = 1 hours;
    uint256 public constant BUY_COOLDOWN = 10 minutes;
    uint256 public constant MAX_DEVIATION_BPS = 200;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    enum Source {
        Factory, // launch factory buyback hook
        Manual, // topUp()
        Direct, // plain ETH transfer
        OtherBuybackCall // buyback() from a non-factory sender
    }

    IPoolManager public immutable poolManager;
    address public immutable weth;
    address public immutable polydash;
    address public immutable hook;
    uint24 public immutable poolFee; // PoolKey.fee (0x800000 = dynamic)
    int24 public immutable tickSpacing;
    address public immutable factoryA;
    address public immutable factoryB;
    uint256 public immutable maxBuyEth;
    uint256 public immutable maxSlippageBps;
    uint256 public immutable maxPoolFeeBps; // cap on the pool+hook fee assumed in the min-output check
    uint256 public immutable burnShareBps; // share of bought POLYDASH burned (rest held for stakers)
    address public immutable stakingFactory; // targets must be pools of this factory
    address public immutable targetAdmin; // may propose / cancel / execute rewards-target changes only
    address public immutable initialTarget; // always accepted as a target (if valid tokens and not ended)
    uint256 public immutable createdAt;

    uint256 public constant TARGET_TIMELOCK = 48 hours;
    uint256 public constant NO_TARGET_BURN_DELAY = 30 days;
    uint256 public constant MIN_TARGET_REMAINING = 1 days;

    address public rewardsTarget;
    address public pendingTarget;
    uint256 public pendingTargetAt; // earliest execution time
    uint256 public targetClearedAt; // when the last target was set to none

    uint256 public totalToStakers; // POLYDASH bought for stakers
    uint256 public totalReleased; // POLYDASH sent to rewards targets
    uint256 public totalStakingBurned; // held staking POLYDASH burned after NO_TARGET_BURN_DELAY

    uint160 public obsSqrtPriceX96;
    uint64 public obsTime;
    uint64 public lastBuyTime;

    uint256 public totalFromFactories;
    uint256 public totalManual;
    uint256 public totalDirect;
    uint256 public totalEthSpent;
    uint256 public totalBurned;
    uint256 public buyCount;

    event Received(Source indexed source, address indexed from, uint256 amount);
    event PriceObserved(address indexed caller, uint160 sqrtPriceX96, uint256 at);
    event BoughtAndBurned(
        address indexed caller,
        uint256 ethIn,
        uint256 polydashBurned,
        uint256 polydashToStakers,
        uint160 sqrtPriceBefore,
        uint160 sqrtPriceAfter
    );
    event TargetProposed(address indexed target, uint256 executeAfter);
    event TargetCancelled(address indexed target);
    event TargetChanged(address indexed oldTarget, address indexed newTarget);
    event RewardsReleased(address indexed target, uint256 amount);
    event HeldStakingBurned(address indexed caller, uint256 amount);

    error InvalidParams();
    error NotPoolManager();
    error NothingPending();
    error Cooldown();
    error NoFreshObservation();
    error ObservationNotDue();
    error PriceMoved();
    error Slippage();
    error NotTargetAdmin();
    error InvalidTarget();
    error NoPending();
    error TimelockActive();
    error NoActiveTarget();
    error TargetActive();
    error TooEarly();
    error Nothing();

    struct Init {
        address poolManager;
        address weth;
        address polydash;
        address hook;
        uint24 poolFee;
        int24 tickSpacing;
        address factoryA;
        address factoryB;
        uint256 maxBuyEth;
        uint256 maxSlippageBps;
        uint256 maxPoolFeeBps;
        uint256 burnShareBps;
        address stakingFactory;
        address targetAdmin;
        address initialTarget; // optional: rewards target active from deployment (no timelock)
    }

    constructor(Init memory p) {
        if (
            p.poolManager == address(0) || p.weth == address(0) || p.polydash == address(0) || p.weth >= p.polydash
                || p.maxBuyEth == 0 || p.maxSlippageBps == 0 || p.maxSlippageBps > 1000 || p.maxPoolFeeBps > 1000
                || p.tickSpacing <= 0 || p.burnShareBps > BPS
                || p.stakingFactory == address(0) || p.targetAdmin == address(0)
        ) revert InvalidParams();
        poolManager = IPoolManager(p.poolManager);
        weth = p.weth;
        polydash = p.polydash;
        hook = p.hook;
        poolFee = p.poolFee;
        tickSpacing = p.tickSpacing;
        factoryA = p.factoryA;
        factoryB = p.factoryB;
        maxBuyEth = p.maxBuyEth;
        maxSlippageBps = p.maxSlippageBps;
        maxPoolFeeBps = p.maxPoolFeeBps;
        burnShareBps = p.burnShareBps;
        stakingFactory = p.stakingFactory;
        targetAdmin = p.targetAdmin;
        createdAt = block.timestamp;
        initialTarget = p.initialTarget;
        if (p.initialTarget != address(0)) {
            rewardsTarget = p.initialTarget;
            if (!isValidTarget(p.initialTarget)) revert InvalidParams();
            emit TargetChanged(address(0), p.initialTarget);
        }
    }

    // ------------------------------------------------------------------ receiving (never reverts)

    /// @notice Called by PolydashFactory.collectPlatformFees with the buyback share. Only records; never reverts.
    function buyback() external payable returns (uint256) {
        if (msg.value == 0) return 0;
        if (msg.sender == factoryA || msg.sender == factoryB) {
            totalFromFactories += msg.value;
            emit Received(Source.Factory, msg.sender, msg.value);
        } else {
            totalDirect += msg.value;
            emit Received(Source.OtherBuybackCall, msg.sender, msg.value);
        }
        return 0;
    }

    /// @notice Labelled manual top-up (e.g. the buyback share of NFT and staking fees).
    function topUp() external payable {
        if (msg.value == 0) return;
        totalManual += msg.value;
        emit Received(Source.Manual, msg.sender, msg.value);
    }

    /// @dev Plain transfers (fits within the 2300 gas stipend: one SSTORE-free log).
    receive() external payable {
        emit Received(Source.Direct, msg.sender, msg.value);
    }

    // ------------------------------------------------------------------ buys (anyone)

    function observePrice() external nonReentrant {
        if (obsTime != 0 && block.timestamp <= obsTime + OBS_MAX_AGE) revert ObservationNotDue();
        uint160 spot = spotSqrtPriceX96();
        obsSqrtPriceX96 = spot;
        obsTime = uint64(block.timestamp);
        emit PriceObserved(msg.sender, spot, block.timestamp);
    }

    function buy() external nonReentrant returns (uint256 ethIn, uint256 burned, uint256 toStakers) {
        uint256 bal = address(this).balance;
        if (bal == 0) revert NothingPending();
        if (lastBuyTime != 0 && block.timestamp < lastBuyTime + BUY_COOLDOWN) revert Cooldown();
        uint256 t = obsTime;
        if (t == 0 || block.timestamp < t + OBS_DELAY || block.timestamp > t + OBS_MAX_AGE) {
            revert NoFreshObservation();
        }
        uint160 ref = obsSqrtPriceX96;
        uint160 before = spotSqrtPriceX96();
        if (!_withinDeviation(before, ref)) revert PriceMoved();

        uint256 amount = bal < maxBuyEth ? bal : maxBuyEth;
        // WETH is currency0; buying POLYDASH (zeroForOne) lowers sqrtPrice. Stop at ref*(1 - slippage/2).
        uint160 limit = uint160((uint256(ref) * (BPS - maxSlippageBps / 2)) / BPS);
        if (limit <= TickMath.MIN_SQRT_PRICE) limit = TickMath.MIN_SQRT_PRICE + 1;

        obsTime = 0;
        lastBuyTime = uint64(block.timestamp);

        (ethIn, burned, toStakers) =
            abi.decode(poolManager.unlock(abi.encode(amount, limit)), (uint256, uint256, uint256));
        if (ethIn == 0 || burned + toStakers < minPolydashOut(ethIn, ref)) revert Slippage();

        totalEthSpent += ethIn;
        totalBurned += burned;
        totalToStakers += toStakers;
        buyCount += 1;
        emit BoughtAndBurned(msg.sender, ethIn, burned, toStakers, before, spotSqrtPriceX96());
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint256 amount, uint160 limit) = abi.decode(data, (uint256, uint160));
        PoolKey memory key = poolKey();
        BalanceDelta d = poolManager.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: limit}),
            ""
        );
        int128 a0 = d.amount0();
        int128 a1 = d.amount1();
        uint256 owed = a0 < 0 ? uint256(int256(-a0)) : 0;
        uint256 out = a1 > 0 ? uint256(int256(a1)) : 0;
        if (owed > amount) revert Slippage();
        if (owed > 0) {
            IWETH9(weth).deposit{value: owed}();
            poolManager.sync(Currency.wrap(weth));
            if (!IWETH9(weth).transfer(address(poolManager), owed)) revert Slippage();
            poolManager.settle();
        }
        uint256 toBurn = (out * burnShareBps) / BPS;
        uint256 toKeep = out - toBurn;
        uint256 deadBefore = IERC20(polydash).balanceOf(DEAD);
        uint256 selfBefore = IERC20(polydash).balanceOf(address(this));
        if (toBurn > 0) poolManager.take(Currency.wrap(polydash), DEAD, toBurn);
        if (toKeep > 0) poolManager.take(Currency.wrap(polydash), address(this), toKeep);
        uint256 burned = IERC20(polydash).balanceOf(DEAD) - deadBefore;
        uint256 kept = IERC20(polydash).balanceOf(address(this)) - selfBefore;
        return abi.encode(owed, burned, kept);
    }

    // ------------------------------------------------------------------ stakers' share

    /// @notice targetAdmin proposes a new rewards target (or address(0) for none). Replaces any pending proposal.
    function proposeTarget(address target) external {
        if (msg.sender != targetAdmin) revert NotTargetAdmin();
        if (target != address(0) && !isValidTarget(target)) revert InvalidTarget();
        pendingTarget = target;
        pendingTargetAt = block.timestamp + TARGET_TIMELOCK;
        emit TargetProposed(target, pendingTargetAt);
    }

    function cancelTarget() external {
        if (msg.sender != targetAdmin) revert NotTargetAdmin();
        if (pendingTargetAt == 0) revert NoPending();
        address t = pendingTarget;
        pendingTarget = address(0);
        pendingTargetAt = 0;
        emit TargetCancelled(t);
    }

    /// @notice targetAdmin executes the pending change after the timelock; held POLYDASH is released to it.
    function executeTarget() external nonReentrant {
        if (msg.sender != targetAdmin) revert NotTargetAdmin();
        if (pendingTargetAt == 0) revert NoPending();
        if (block.timestamp < pendingTargetAt) revert TimelockActive();
        address t = pendingTarget;
        if (t != address(0) && !isValidTarget(t)) revert InvalidTarget(); // re-check: may have ended meanwhile
        address old = rewardsTarget;
        rewardsTarget = t;
        pendingTarget = address(0);
        pendingTargetAt = 0;
        if (t == address(0)) targetClearedAt = block.timestamp;
        emit TargetChanged(old, t);
        if (t != address(0)) _release(t);
    }

    /// @notice Anyone: send held POLYDASH to the rewards target while it is active.
    function releaseToTarget() external nonReentrant returns (uint256) {
        address t = rewardsTarget;
        if (!targetActive()) revert NoActiveTarget();
        return _release(t);
    }

    /// @notice Anyone: burn held staking POLYDASH once there has been no active target for NO_TARGET_BURN_DELAY.
    function burnHeldStaking() external nonReentrant returns (uint256 amount) {
        if (targetActive()) revert TargetActive();
        if (block.timestamp < inactiveSince() + NO_TARGET_BURN_DELAY) revert TooEarly();
        amount = IERC20(polydash).balanceOf(address(this));
        if (amount == 0) revert Nothing();
        totalStakingBurned += amount;
        if (!IERC20(polydash).transfer(DEAD, amount)) revert Nothing();
        emit HeldStakingBurned(msg.sender, amount);
    }

    function _release(address t) internal returns (uint256 amount) {
        amount = IERC20(polydash).balanceOf(address(this));
        if (amount == 0) return 0;
        totalReleased += amount;
        if (!IERC20(polydash).approve(t, amount)) revert InvalidTarget();
        IRewardsTarget(t).notifyRewardAmount(amount);
        if (IERC20(polydash).allowance(address(this), t) != 0) revert InvalidTarget(); // must pull the full amount
        emit RewardsReleased(t, amount);
    }

    /// @notice A target must be a contract that is `initialTarget` or registered in `stakingFactory`, stake and reward POLYDASH, and have
    ///   at least MIN_TARGET_REMAINING left before it ends.
    function isValidTarget(address t) public view returns (bool) {
        if (t.code.length == 0) return false;
        if (t != initialTarget) {
            try IStakingFactoryInfo(stakingFactory).isPool(t) returns (bool ok) {
                if (!ok) return false;
            } catch {
                return false;
            }
        }
        try IRewardsTarget(t).rewardToken() returns (address r) {
            if (r != polydash) return false;
        } catch {
            return false;
        }
        try IRewardsTarget(t).stakeToken() returns (address st) {
            if (st != polydash) return false;
        } catch {
            return false;
        }
        try IRewardsTarget(t).acceptsRewardTopUps() returns (bool yes) {
            if (!yes) return false;
        } catch {
            return false;
        }
        try IRewardsTarget(t).endTime() returns (uint256 e) {
            return e >= block.timestamp + MIN_TARGET_REMAINING;
        } catch {
            return false;
        }
    }

    function targetEndTime() public view returns (uint256) {
        address t = rewardsTarget;
        if (t == address(0)) return 0;
        try IRewardsTarget(t).endTime() returns (uint256 e) {
            return e;
        } catch {
            return 0;
        }
    }

    function targetActive() public view returns (bool) {
        return rewardsTarget != address(0) && block.timestamp < targetEndTime();
    }

    /// @notice Since when there has been no active target (0 if one is active).
    function inactiveSince() public view returns (uint256) {
        if (targetActive()) return 0;
        if (rewardsTarget == address(0)) return targetClearedAt > createdAt ? targetClearedAt : createdAt;
        uint256 e = targetEndTime();
        return e > createdAt ? e : createdAt;
    }

    function heldForStakers() external view returns (uint256) {
        return IERC20(polydash).balanceOf(address(this));
    }

    // ------------------------------------------------------------------ views

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(weth), Currency.wrap(polydash), poolFee, tickSpacing, IHooks(hook));
    }

    function poolId() external view returns (bytes32) {
        return PoolId.unwrap(poolKey().toId());
    }

    function spotSqrtPriceX96() public view returns (uint160 s) {
        (s,,,) = poolManager.getSlot0(poolKey().toId());
    }

    function pendingEth() external view returns (uint256) {
        return address(this).balance;
    }

    function totalReceived() external view returns (uint256) {
        return totalEthSpent + address(this).balance;
    }

    /// @notice Fee on the WETH in, in bps: Clanker static-fee hook pairedFee + protocolFee (both in pips),
    ///   capped at maxPoolFeeBps; falls back to maxPoolFeeBps if the hook cannot be read.
    function poolFeeBps() public view returns (uint256) {
        if (hook == address(0)) {
            (,,, uint24 lpFee) = poolManager.getSlot0(poolKey().toId());
            uint256 b = uint256(lpFee) / 100;
            return b > maxPoolFeeBps ? maxPoolFeeBps : b;
        }
        bytes32 id = PoolId.unwrap(poolKey().toId());
        (bool ok1, bytes memory r1) = hook.staticcall(abi.encodeWithSignature("pairedFee(bytes32)", id));
        (bool ok2, bytes memory r2) = hook.staticcall(abi.encodeWithSignature("protocolFee()"));
        if (!ok1 || !ok2 || r1.length < 32 || r2.length < 32) return maxPoolFeeBps;
        uint256 pips = abi.decode(r1, (uint256)) + abi.decode(r2, (uint256));
        uint256 bps = (pips + 99) / 100;
        return bps > maxPoolFeeBps ? maxPoolFeeBps : bps;
    }

    /// @notice Minimum POLYDASH for `ethIn` at `sqrtP` (POLYDASH per WETH = sqrtP^2 / 2^192), net of fees and slippage.
    function minPolydashOut(uint256 ethIn, uint160 sqrtP) public view returns (uint256) {
        uint256 net = (ethIn * (BPS - poolFeeBps())) / BPS;
        uint256 q = Math.mulDiv(Math.mulDiv(net, sqrtP, 1 << 96), sqrtP, 1 << 96);
        return (q * (BPS - maxSlippageBps)) / BPS;
    }

    /// @notice 0 none, 1 record price, 2 wait for window, 3 buy.
    function nextStep() external view returns (uint8 step, uint256 at) {
        if (address(this).balance == 0) return (0, 0);
        uint256 t = obsTime;
        uint256 cd = lastBuyTime == 0 ? 0 : lastBuyTime + BUY_COOLDOWN;
        if (t == 0 || block.timestamp > t + OBS_MAX_AGE) return (1, block.timestamp);
        uint256 open = t + OBS_DELAY > cd ? t + OBS_DELAY : cd;
        if (open > t + OBS_MAX_AGE) return (1, t + OBS_MAX_AGE + 1);
        if (block.timestamp < open) return (2, open);
        return (3, block.timestamp);
    }

    function _withinDeviation(uint160 spot, uint160 ref) internal pure returns (bool) {
        uint256 r = Math.mulDiv(spot, 1e18, ref);
        uint256 r2 = Math.mulDiv(r, r, 1e18);
        return r2 >= 1e18 * (BPS - MAX_DEVIATION_BPS) / BPS && r2 <= 1e18 * (BPS + MAX_DEVIATION_BPS) / BPS;
    }
}
