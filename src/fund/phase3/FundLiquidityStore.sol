// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFundAllowlist} from "../phase2/Interfaces.sol";
import {NAVReader} from "../phase2/NAVReader.sol";
import {FundVaultStore} from "../phase2/FundVaultStore.sol";
import {FundPhase3Store} from "./FundPhase3Store.sol";
import {FundProposalStore} from "./FundProposalStore.sol";

/// @title FundLiquidityStore (not reviewed, not deployed)
/// @notice Storage appended after `FundProposalStore` for a Phase 3 V3 vault and its
///         liquidity facet. Both contracts inherit the stores in the same order —
///         `FundVaultStore`, `FundPhase3Store`, `FundProposalStore`, then this store —
///         so a delegatecall sees one layout. New storage goes at the end of this
///         contract only, never in the middle. The V3 vault declares `stakeFacet` and
///         `mandateUri` after all four stores; the facets never read them.
///
///         v1 scope (Jon's decisions, 2026-11-14): LP cap 50% of vault NAV; POLYDASH/WETH
///         Uniswap V4 pool only (the template universe is [POLYDASH], so no other pool
///         can ever qualify); weekly harvest cadence; same 0/5/10/20% performance-fee
///         menu; human manager first.
///
///         What an LP position is here: the vault's tokens sit in a Uniswap V4 pool
///         (added via `PoolManager.modifyLiquidity` through `unlock`), and this store
///         tracks the principal amounts per pool so `nav()` can value them. The pool
///         itself holds the tokens — the vault's spot balances drop when liquidity is
///         added and rise again when it is removed. One active tick range per pool in v1.
///
///         Exits: an exit pays the holder's pro-rata share of the vault's *liquid*
///         holdings (ETH / WETH / spot tokens). LP principal is NOT paid out in-kind
///         on exit in v1 — it stays in the pool backing the remaining holders, and its
///         value is realised when the manager removes liquidity (removal is always
///         permitted, even when buys are paused). The front end must show this.
///         This contract is not deployed. Not a review. Not financial advice.
abstract contract FundLiquidityStore is FundVaultStore, FundPhase3Store, FundProposalStore {
    /// @notice Max share of vault NAV in LP positions: 50% (Jon's decision).
    uint256 public constant MAX_LP_BPS = 5000;
    /// @notice Minimum time between fee harvests from one position: 7 days (weekly cadence).
    uint256 public constant HARVEST_INTERVAL = 7 days;
    /// @notice A position's tick range must be this wide at minimum (in ticks) so the
    ///         manager cannot open a razor-thin range that behaves like a limit order.
    int24 public constant MIN_RANGE_TICKS = 200;

    /// @notice Minimal Uniswap V4 pool key, ABI-identical to v4-core's `PoolKey`
    ///         (Currency is an address wrapper, IHooks is an address), so
    ///         `keccak256(abi.encode(key))` equals the canonical v4 `PoolId`.
    ///         Declared locally on purpose: this file compiles under the
    ///         `src/fund/phase3/**` paris restriction and must not import v4-core.
    struct LpPoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    enum LpProposalStatus {
        Pending,
        Executed,
        Cancelled
    }

    struct LpProposal {
        LpPoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint256 maxLpBps;
        string reason;
        string thesisUri;
        uint64 readyAt;
        LpProposalStatus status;
    }

    struct LpPosition {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
        int24 tickLower;
        int24 tickUpper;
        uint256 liquidity;
        uint256 amount0;
        uint256 amount1;
        uint256 feesHarvested0;
        uint256 feesHarvested1;
        uint64 lastHarvestAt;
        bool active;
    }

    /// @notice V4 PoolManager the facet unlocks (canonical Robinhood Chain address on mainnet).
    address public lpPoolManager;
    /// @notice Sequential LP proposal ids, starting at 1.
    uint256 public lpProposalCount;
    mapping(uint256 => LpProposal) public lpProposals;
    /// @notice True once an LP proposal for a pool has executed. Add-liquidity requires it.
    mapping(bytes32 => bool) public lpApproved;
    /// @notice Max LP bps per pool, set when its proposal executes (0 = `MAX_LP_BPS`).
    mapping(bytes32 => uint256) public lpCap;
    /// @notice Approved tick range per pool, set when its proposal executes.
    mapping(bytes32 => int24) public lpTickLower;
    mapping(bytes32 => int24) public lpTickUpper;
    /// @notice Live LP positions, keyed by pool id.
    mapping(bytes32 => LpPosition) public lpPositions;
    /// @notice Pool ids with a position record, for NAV / enumeration. Never shrunk:
    ///         a fully-removed position stays listed with zero liquidity.
    bytes32[] internal _lpPoolIds;

    event LpProposed(
        uint256 indexed id,
        bytes32 indexed poolId,
        address currency0,
        address currency1,
        uint256 maxLpBps,
        string reason,
        string thesisUri,
        uint64 readyAt
    );
    event LpProposalExecuted(uint256 indexed id, bytes32 indexed poolId, uint256 maxLpBps);
    event LpProposalCancelled(uint256 indexed id, bytes32 indexed poolId);
    event LiquidityAdded(
        bytes32 indexed poolId, uint256 liquidity, uint256 amount0, uint256 amount1, uint256 lpValueAfter
    );
    event LiquidityRemoved(
        bytes32 indexed poolId, uint256 liquidity, uint256 amount0, uint256 amount1, uint256 lpValueAfter
    );
    event FeesHarvested(bytes32 indexed poolId, uint256 amount0, uint256 amount1);

    error LpNotApproved();
    error LpCapExceeded();
    error LpBadTicks();
    error LpRangeMismatch();
    error LpNoPosition();
    error LpHarvestTooSoon();
    error LpBadPool();
    error LpBadPoolManager();

    /// @notice Canonical v4 pool id for a key: `keccak256(abi.encode(key))`.
    function lpPoolId(LpPoolKey memory key) public pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    /// @notice Pool ids with a position record, paginated (`offset` 0-based).
    function lpPoolIds(uint256 offset, uint256 limit) external view returns (bytes32[] memory ids) {
        if (offset >= _lpPoolIds.length || limit == 0) return new bytes32[](0);
        uint256 end = offset + limit;
        if (end > _lpPoolIds.length) end = _lpPoolIds.length;
        ids = new bytes32[](end - offset);
        for (uint256 i; i < ids.length; ++i) {
            ids[i] = _lpPoolIds[offset + i];
        }
    }

    function lpPoolCount() external view returns (uint256) {
        return _lpPoolIds.length;
    }

    /// @notice Total value (ETH wei, at the allowlist feeds) of all LP principal.
    ///         WETH is valued at face value; any other token via `allowlist.quote`.
    ///         Reverts on a bad feed, same fail-closed rule as `nav()`.
    function lpValue() public view returns (uint256 total) {
        uint256 n = _lpPoolIds.length;
        for (uint256 i; i < n; ++i) {
            LpPosition storage p = lpPositions[_lpPoolIds[i]];
            if (p.liquidity == 0) continue;
            total += _lpTokenValue(p.currency0, p.amount0);
            total += _lpTokenValue(p.currency1, p.amount1);
        }
    }

    /// @notice Fee-excluded NAV total including LP principal. Used by the facet for
    ///         cap checks and by the V3 vault's `nav()`.
    function navTotalWithLp() public view returns (uint256) {
        uint256 base = NAVReader.netTotal(
            address(this).balance, IERC20(weth).balanceOf(address(this)), _mandateAssets, allowlist, _lpClaimableFees()
        );
        return base + lpValue();
    }

    /// @notice True when a harvest is due for a pool (never harvested, or a week passed).
    function harvestDue(bytes32 poolId) external view returns (bool) {
        LpPosition storage p = lpPositions[poolId];
        if (!p.active || p.liquidity == 0) return false;
        return p.lastHarvestAt == 0 || block.timestamp >= uint256(p.lastHarvestAt) + HARVEST_INTERVAL;
    }

    function _lpTokenValue(address token, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        if (token == weth) return amount;
        return allowlist.quote(token, amount);
    }

    function _lpClaimableFees() internal view returns (uint256) {
        return (entryFeeAccrued - entryFeeClaimed) + (protocolFeeAccrued - protocolFeeClaimed)
            + (performanceFeeAccrued - performanceFeeClaimed) + distributionReserved;
    }
}
