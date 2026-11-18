// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundAllowlist} from "../../../src/fund/phase2/FundAllowlist.sol";
import {FundVaultStore} from "../../../src/fund/phase2/FundVaultStore.sol";
import {FundFactoryPhase3V3} from "../../../src/fund/phase3/FundFactoryPhase3V3.sol";
import {FundSwapFacetPhase3V2} from "../../../src/fund/phase3/FundSwapFacetPhase3V2.sol";
import {FundNFTPhase3} from "../../../src/fund/phase3/FundNFTPhase3.sol";
import {FundLiquidityFacetPhase3} from "../../../src/fund/phase3/FundLiquidityFacetPhase3.sol";
import {FundLiquidityStore} from "../../../src/fund/phase3/FundLiquidityStore.sol";
import {FundProposalStore} from "../../../src/fund/phase3/FundProposalStore.sol";
import {FundVaultPhase3V3} from "../../../src/fund/phase3/FundVaultPhase3V3.sol";
import {StrategyTemplate} from "../../../src/fund/phase3/StrategyTemplate.sol";
import {MockERC20} from "../../mocks/MockERC20.sol";
import {MockFeed, MockWETH, RateRouter} from "../InvestMocks.sol";

/// @dev Minimal V4 PoolManager stand-in at a fixed 1:1 price (tick 0). `modifyLiquidity`
///      prices one liquidity unit as one unit of each token; removals pay back the
///      principal share plus all accrued fees; a zero-delta call pays the accrued fees.
///      It holds the tokens settled to it, exactly like the real PoolManager.
contract MockPoolManager {
    struct Key {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ModifyParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        bytes32 salt;
    }

    mapping(bytes32 => uint256) public liquidity;
    mapping(bytes32 => uint256) public principal0;
    mapping(bytes32 => uint256) public principal1;
    mapping(bytes32 => uint256) public fees0;
    mapping(bytes32 => uint256) public fees1;

    function unlock(bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) =
            msg.sender.call(abi.encodeWithSignature("unlockCallback(bytes)", data));
        require(ok, "callback failed");
        // The real V4 PoolManager returns the callback's bytes verbatim (it calls
        // unlockCallback via a high-level call and returns the decoded bytes). A
        // low-level `.call` returns the ABI encoding of those bytes instead, so
        // unwrap one layer here — otherwise the facet decodes (offset, length, ...)
        // as the amounts and every cap check sees dust.
        return abi.decode(ret, (bytes));
    }

    function modifyLiquidity(Key calldata key, ModifyParams calldata params, bytes calldata)
        external
        returns (int256 callerDelta, int256 feesAccrued)
    {
        bytes32 poolId = keccak256(abi.encode(key));
        require(params.tickLower < 0 && params.tickUpper > 0, "out of range");
        int256 delta = params.liquidityDelta;
        if (delta > 0) {
            uint256 liq = uint256(delta);
            principal0[poolId] += liq;
            principal1[poolId] += liq;
            liquidity[poolId] += liq;
            callerDelta = _pack(-int256(liq), -int256(liq));
            feesAccrued = 0;
        } else if (delta == 0) {
            uint256 f0 = fees0[poolId];
            uint256 f1 = fees1[poolId];
            fees0[poolId] = 0;
            fees1[poolId] = 0;
            callerDelta = _pack(int256(f0), int256(f1));
            feesAccrued = callerDelta;
        } else {
            uint256 liq = uint256(-delta);
            uint256 liqBefore = liquidity[poolId];
            require(liq <= liqBefore, "too much");
            uint256 p0 = (principal0[poolId] * liq) / liqBefore;
            uint256 p1 = (principal1[poolId] * liq) / liqBefore;
            uint256 f0 = fees0[poolId];
            uint256 f1 = fees1[poolId];
            principal0[poolId] -= p0;
            principal1[poolId] -= p1;
            fees0[poolId] = 0;
            fees1[poolId] = 0;
            liquidity[poolId] -= liq;
            callerDelta = _pack(int256(p0 + f0), int256(p1 + f1));
            feesAccrued = _pack(int256(f0), int256(f1));
        }
    }

    function sync(address) external {}

    function settle() external payable returns (uint256) {
        return 0;
    }

    function take(address currency, address to, uint256 amount) external {
        require(IERC20(currency).transfer(to, amount), "take failed");
    }

    /// @notice Test-only: credit accrued fees for a pool. The test funds this contract
    ///         with the fee tokens first (transfer them here, then call this).
    function setFees(bytes32 poolId, uint256 f0, uint256 f1) external {
        fees0[poolId] = f0;
        fees1[poolId] = f1;
    }

    /// @notice v4 BalanceDelta packing: amount0 in the HIGH 128 bits, amount1 in
    ///         the LOW 128 bits (matches v4-core `toBalanceDelta`, which shifts
    ///         amount0 left by 128). Packing it the other way round silently swaps
    ///         the two currencies in every settle.
    function _pack(int256 a0, int256 a1) internal pure returns (int256) {
        return int256((uint256(uint128(uint256(a0))) << 128) | uint256(uint128(uint256(a1))));
    }

    receive() external payable {}
}

/// @notice No-op stand-in for the stake facet. Its functions MUST write no storage:
///         the vault delegatecalls them, so any state write would land in the vault's
///         slots and corrupt the reentrancy guard. Real behaviour is covered by
///         StakeFacet.t.sol (harness) and StakeFacetFork.t.sol (mainnet fork).
contract MockStakeFacet {
    function stake(address, uint256) external {}
    function unstake(address, uint256) external {}
    function unstakeAll(address) external {}
    function claimRewards(address, uint256) external {}
}

/// @title LPDividendTest (not reviewed, not deployed)
/// @notice Local unit tests for Strategy #6 (LP-Dividend): `FundVaultPhase3V3` /
///         `FundFactoryPhase3V3` / `FundLiquidityFacetPhase3` with a mock V4
///         PoolManager at a fixed 1:1 price. No fork: mock WETH, mock assets at 1:1,
///         fresh allowlist + template + V3 factory. The fund holds 2 ETH of NAV
///         (2 shares at 1 ETH), template caps 8000 max position / 1000 max trade /
///         500 max deviation, drawdown brake 20%, LP cap 50%.
contract LPDividendTest is Test {
    MockWETH weth;
    MockERC20 assetA; // template asset (POLYDASH stand-in), in the mandate from creation
    MockERC20 assetB; // proposed asset, for the per-asset-cap test
    MockFeed feedA;
    MockFeed feedB;
    RateRouter router;
    MockPoolManager poolManager;
    FundAllowlist allow;
    StrategyTemplate templates;
    FundFactoryPhase3V3 factory;
    FundLiquidityFacetPhase3 facet;
    uint256 templateId;

    address manager = makeAddr("manager");
    address buyer = makeAddr("buyer");

    /// @notice NAV after the 2 ETH raise: the 20 bps protocol fee (0.002 ETH per
    ///         1 ETH mint) accrues to the fee recipient and is excluded from NAV,
    ///         so the vault holds 2 - 0.004 = 1.996 ETH of value, not 2.
    uint256 internal constant EXPECTED_NAV = 1.996 ether;

    function setUp() public {
        weth = new MockWETH();
        // The test funds the mock PoolManager with fee tokens directly, so it
        // needs its own WETH (deposit 1 ETH into the mock WETH contract).
        vm.deal(address(this), 10 ether);
        weth.deposit{value: 1 ether}();
        assetA = new MockERC20("Alpha", "ALP", 0);
        assetB = new MockERC20("Beta", "BET", 0);
        feedA = new MockFeed();
        feedA.setPrice(1e18);
        feedB = new MockFeed();
        feedB.setPrice(1e18);
        router = new RateRouter(1e18, 1e18);
        assetA.transfer(address(router), 1000 ether);
        assetB.transfer(address(router), 1000 ether);
        vm.deal(address(router), 100 ether);
        vm.deal(manager, 50 ether);
        vm.deal(buyer, 50 ether);
        poolManager = new MockPoolManager();

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        FundAllowlist.AssetInit[] memory seeded = new FundAllowlist.AssetInit[](3);
        seeded[0] = FundAllowlist.AssetInit(address(weth), true, address(0), 0, 0, 0);
        seeded[1] = FundAllowlist.AssetInit(address(assetA), false, address(feedA), 1 hours, 0.1e18, 10e18);
        seeded[2] = FundAllowlist.AssetInit(address(assetB), false, address(feedB), 1 hours, 0.1e18, 10e18);
        allow = new FundAllowlist(address(this), 1 days, routers, seeded);

        templates = new StrategyTemplate(address(this));
        address[] memory universe = new address[](1);
        universe[0] = address(assetA);
        // Template #6 shape: [POLYDASH], 8000/1000/500, 5% HWM fee, 20% brake, 30-day skin lock.
        templateId = templates.publish(
            keccak256("mandate-strategy-6"), "ipfs://strategy-6-mandate", universe, 8000, 1000, 500, 500, 2000, 30 days
        );
        facet = new FundLiquidityFacetPhase3();
        factory = new FundFactoryPhase3V3(
            address(this),
            address(allow),
            address(weth),
            address(new FundSwapFacetPhase3V2()),
            address(facet),
            address(templates),
            address(0), // no stake facet yet: the manager sets it later per fund
            makeAddr("stakingFactory"),
            address(0),
            address(assetA),
            address(poolManager)
        );
    }

    // --- Helpers ---

    function _key(address token) internal view returns (FundLiquidityStore.LpPoolKey memory) {
        (address c0, address c1) = address(token) < address(weth)
            ? (address(token), address(weth))
            : (address(weth), address(token));
        return FundLiquidityStore.LpPoolKey({
            currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: address(0)
        });
    }

    function _open() internal returns (FundNFTPhase3 nft, FundVaultPhase3V3 vault) {
        (nft, vault) = _raise();
        vm.prank(manager);
        vault.enableInvesting();
    }

    function _raise() internal returns (FundNFTPhase3 nft, FundVaultPhase3V3 vault) {
        vm.prank(manager);
        nft = FundNFTPhase3(
            factory.createFund(
                FundFactoryPhase3V3.Params({
                    templateId: templateId,
                    name: "LP Dividend",
                    symbol: "LPDIV",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 1 ether,
                    raiseCap: 2 ether,
                    entryFeeBps: 0,
                    minSkinBps: 5000,
                    raiseDuration: 30 days
                })
            )
        );
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        vault = FundVaultPhase3V3(payable(address(nft.vault())));
    }

    /// @dev Fund the vault with `amount` assetA + `amount` WETH via the swap facet.
    ///      Buys are chunked at 0.1 ETH: the template's 10% trade cap rejects bigger buys.
    function _fundLpTokens(FundVaultPhase3V3 vault, uint256 amount) internal {
        uint256 remaining = amount;
        while (remaining > 0) {
            uint256 chunk = remaining > 0.1 ether ? 0.1 ether : remaining;
            vm.prank(manager);
            vault.swap(address(router), address(0), address(assetA), chunk, 1, "");
            remaining -= chunk;
        }
        vm.prank(manager);
        vault.swap(address(0), address(0), address(weth), amount, 1, "");
    }

    function _executeLp(FundVaultPhase3V3 vault, FundLiquidityStore.LpPoolKey memory key, uint256 maxLpBps)
        internal
        returns (uint256 id)
    {
        vm.prank(manager);
        id = vault.proposeLiquidity(key, -600, 600, maxLpBps, "POLYDASH/WETH earns fees", "ipfs://thesis-lp");
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        vault.executeLiquidity(id);
    }

    function _lpPosition(FundVaultPhase3V3 vault, bytes32 poolId)
        internal
        view
        returns (FundLiquidityStore.LpPosition memory pos)
    {
        (
            pos.currency0,
            pos.currency1,
            pos.fee,
            pos.tickSpacing,
            pos.hooks,
            pos.tickLower,
            pos.tickUpper,
            pos.liquidity,
            pos.amount0,
            pos.amount1,
            pos.feesHarvested0,
            pos.feesHarvested1,
            pos.lastHarvestAt,
            pos.active
        ) = vault.lpPositions(poolId);
    }

    // --- Full happy path: propose -> wait -> execute -> add -> harvest -> distribute -> remove ---

    function test_fullLpLoop() public {
        (FundNFTPhase3 nft, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.5 ether);
        assertEq(vault.nav(), EXPECTED_NAV);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        bytes32 poolId = vault.lpPoolId(key);

        // Early execution reverts; after the wait it approves the pool.
        vm.prank(manager);
        uint256 id = vault.proposeLiquidity(key, -600, 600, 0, "POLYDASH/WETH earns fees", "ipfs://thesis-lp");
        assertEq(vault.lpProposalCount(), 1);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.TooEarly.selector);
        vault.executeLiquidity(id);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        vault.executeLiquidity(id);
        assertTrue(vault.lpApproved(poolId));
        assertEq(vault.lpCap(poolId), 5000); // 0 means the 50% default

        // Add 0.1 liquidity (0.1 assetA + 0.1 WETH at the 1:1 mock price).
        vm.prank(manager);
        vault.addLiquidity(key, -600, 600, 0.1 ether, 0.1 ether, 0.1 ether);
        FundLiquidityStore.LpPosition memory pos = _lpPosition(vault, poolId);
        assertTrue(pos.active);
        assertEq(pos.liquidity, 0.1 ether);
        assertEq(pos.amount0 + pos.amount1, 0.2 ether);
        assertEq(vault.lpValue(), 0.2 ether);
        assertEq(vault.nav(), EXPECTED_NAV); // NAV is unchanged by the add (tokens moved, not lost)

        // Accrue fees, warp a week, harvest: fee tokens land in the vault.
        assetA.transfer(address(poolManager), 0.01 ether);
        weth.transfer(address(poolManager), 0.01 ether);
        poolManager.setFees(poolId, 0.01 ether, 0.01 ether);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        vm.prank(manager);
        (uint256 got0, uint256 got1) = vault.harvestFees(key);
        assertEq(got0 + got1, 0.02 ether);
        pos = _lpPosition(vault, poolId);
        assertEq(pos.feesHarvested0 + pos.feesHarvested1, 0.02 ether);
        assertGt(pos.lastHarvestAt, 0);

        // Dividend flow: sell the harvested assetA for ETH, unwrap the WETH, distribute.
        uint256 harvestedA = key.currency0 == address(assetA) ? got0 : got1;
        uint256 harvestedW = key.currency0 == address(weth) ? got0 : got1;
        assertEq(harvestedA, 0.01 ether);
        assertEq(harvestedW, 0.01 ether);
        vm.prank(manager);
        vault.swap(address(router), address(assetA), address(0), harvestedA, 1, "");
        vm.prank(manager);
        vault.swap(address(0), address(weth), address(0), harvestedW, 1, "");
        vm.prank(manager);
        uint256 roundId = vault.distribute(0.02 ether);
        assertEq(roundId, 1);
        (uint256 perUnit, uint256 pot) = vault.rounds(1);
        assertEq(perUnit, 0.01 ether);
        assertEq(pot, 0.02 ether);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 2;
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        uint256 paid = vault.claim(ids);
        assertEq(paid, 0.01 ether);
        assertEq(buyer.balance, buyerBefore + 0.01 ether);

        // Remove half the liquidity: principal comes back to the vault.
        vm.prank(manager);
        vault.removeLiquidity(key, 0.05 ether, 0.05 ether, 0.05 ether);
        pos = _lpPosition(vault, poolId);
        assertEq(pos.liquidity, 0.05 ether);
        assertTrue(pos.active);
        // Remove the rest: the position closes.
        vm.prank(manager);
        vault.removeLiquidity(key, 0.05 ether, 0.05 ether, 0.05 ether);
        pos = _lpPosition(vault, poolId);
        assertEq(pos.liquidity, 0);
        assertFalse(pos.active);
        assertEq(vault.lpValue(), 0);
        // 1.995, not 1.996: distribute() crystallized the 5% performance fee on the
        // 0.02 ETH harvested gain above the high-water mark (0.001 ETH), which is
        // excluded from NAV like the protocol fee.
        assertEq(vault.nav(), 1.995 ether);
        assertEq(nft.balanceOf(buyer), 1);
    }

    // --- Caps ---

    function test_lpCap_binds_at_50pct() public {
        (, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.6 ether);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        _executeLp(vault, key, 0);
        // 0.6 + 0.6 = 1.2 ETH of LP value is 60% of the 2 ETH NAV: over the 50% cap.
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpCapExceeded.selector);
        vault.addLiquidity(key, -600, 600, 0.6 ether, 0.6 ether, 0.6 ether);
        // 0.4 + 0.4 = 0.8 ETH is 40%: under the cap, and it succeeds.
        vm.prank(manager);
        vault.addLiquidity(key, -600, 600, 0.4 ether, 0.4 ether, 0.4 ether);
        assertEq(vault.lpValue(), 0.8 ether);
    }

    function test_perPoolCap_below_50pct_binds() public {
        (, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.5 ether);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        // The LP proposal caps this pool at 20% of NAV.
        _executeLp(vault, key, 2000);
        // 0.15 + 0.15 = 0.3 ETH is 15%: under the 20% pool cap.
        vm.prank(manager);
        vault.addLiquidity(key, -600, 600, 0.15 ether, 0.15 ether, 0.15 ether);
        // Another 0.15 would take LP to 0.6 ETH = 30%: over the pool cap, under 50%.
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpCapExceeded.selector);
        vault.addLiquidity(key, -600, 600, 0.15 ether, 0.15 ether, 0.15 ether);
    }

    function test_perAssetCap_counts_spot_plus_lp() public {
        (, FundVaultPhase3V3 vault) = _open();
        // assetB joins the mandate at a 20% per-asset cap via the asset proposal flow.
        vm.prank(manager);
        uint256 aid = vault.proposeAsset(address(assetB), 2000, "Beta grows", "ipfs://thesis-beta");
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        vault.executeAsset(aid);
        // Buy 0.35 assetB (17.5% of NAV, under the 20% cap) and wrap 0.35 WETH.
        // Buys are chunked at 0.1 ETH: the template's 10% trade cap rejects bigger buys.
        uint256 remaining = 0.35 ether;
        while (remaining > 0) {
            uint256 chunk = remaining > 0.1 ether ? 0.1 ether : remaining;
            vm.prank(manager);
            vault.swap(address(router), address(0), address(assetB), chunk, 1, "");
            remaining -= chunk;
        }
        vm.prank(manager);
        vault.swap(address(0), address(0), address(weth), 0.35 ether, 1, "");
        FundLiquidityStore.LpPoolKey memory keyB = _key(address(assetB));
        _executeLp(vault, keyB, 0);
        // 0.05 LP: assetB total 0.35 = 17.5% of NAV — allowed.
        vm.prank(manager);
        vault.addLiquidity(keyB, -600, 600, 0.05 ether, 0.05 ether, 0.05 ether);
        // Moving tokens from spot to LP does NOT grow the position — spot + LP
        // stays 0.35 — so the cap cannot bind on a second add at the same price.
        // Raise the assetB price 20% instead: the 0.35 position is now worth
        // 0.42 ETH against a 2.066 ETH NAV, over the 20% cap (0.4132 ETH), so
        // the next add must revert.
        feedB.setPrice(1.2 ether);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.PositionCap.selector);
        vault.addLiquidity(keyB, -600, 600, 0.05 ether, 0.05 ether, 0.05 ether);
    }

    // --- Proposal validation ---

    function test_proposeLiquidity_validation() public {
        (, FundVaultPhase3V3 vault) = _open();
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        // Non-manager cannot propose.
        vm.prank(buyer);
        vm.expectRevert(FundVaultStore.NotManager.selector);
        vault.proposeLiquidity(key, -600, 600, 0, "Why", "ipfs://x");
        // A pool with no WETH side is rejected.
        FundLiquidityStore.LpPoolKey memory badKey = FundLiquidityStore.LpPoolKey({
            currency0: address(assetA), currency1: address(assetB), fee: 3000, tickSpacing: 60, hooks: address(0)
        });
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpBadPool.selector);
        vault.proposeLiquidity(badKey, -600, 600, 0, "Why", "ipfs://x");
        // Unsorted currencies are rejected (canonical key order).
        FundLiquidityStore.LpPoolKey memory unsorted = FundLiquidityStore.LpPoolKey({
            currency0: key.currency1, currency1: key.currency0, fee: 3000, tickSpacing: 60, hooks: address(0)
        });
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpBadPool.selector);
        vault.proposeLiquidity(unsorted, -600, 600, 0, "Why", "ipfs://x");
        // Bad ticks: inverted, off-spacing, too narrow.
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpBadTicks.selector);
        vault.proposeLiquidity(key, 600, -600, 0, "Why", "ipfs://x");
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpBadTicks.selector);
        vault.proposeLiquidity(key, -601, 600, 0, "Why", "ipfs://x");
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpBadTicks.selector);
        vault.proposeLiquidity(key, -60, 60, 0, "Why", "ipfs://x");
        // LP cap above 50% is rejected.
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadValue.selector);
        vault.proposeLiquidity(key, -600, 600, 5001, "Why", "ipfs://x");
        // The non-WETH token must already be in the mandate.
        FundLiquidityStore.LpPoolKey memory keyB = _key(address(assetB));
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotInMandate.selector);
        vault.proposeLiquidity(keyB, -600, 600, 0, "Why", "ipfs://x");
        // Empty thesis reverts; an over-long reason reverts.
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadUri.selector);
        vault.proposeLiquidity(key, -600, 600, 0, "Why", "");
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadUri.selector);
        vault.proposeLiquidity(key, -600, 600, 0, string(new bytes(513)), "ipfs://x");
    }

    function test_addBeforeExecute_reverts() public {
        (, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.5 ether);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        vm.prank(manager);
        vault.proposeLiquidity(key, -600, 600, 0, "POLYDASH/WETH earns fees", "ipfs://thesis-lp");
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpNotApproved.selector);
        vault.addLiquidity(key, -600, 600, 0.1 ether, 0.1 ether, 0.1 ether);
    }

    function test_wrongRange_reverts() public {
        (, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.5 ether);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        _executeLp(vault, key, 0);
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpRangeMismatch.selector);
        vault.addLiquidity(key, -1200, 1200, 0.1 ether, 0.1 ether, 0.1 ether);
    }

    function test_cancelLiquidityProposal() public {
        (, FundVaultPhase3V3 vault) = _open();
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        vm.prank(manager);
        uint256 id = vault.proposeLiquidity(key, -600, 600, 0, "POLYDASH/WETH earns fees", "ipfs://thesis-lp");
        vm.prank(manager);
        vault.cancelLiquidityProposal(id);
        vm.warp(vm.getBlockTimestamp() + 3 days);
        vm.prank(manager);
        vm.expectRevert(FundProposalStore.NotPending.selector);
        vault.executeLiquidity(id);
        assertFalse(vault.lpApproved(vault.lpPoolId(key)));
    }

    // --- Pause: blocks adds, never blocks removals or harvests ---

    function test_pauseBlocksAdd_notRemoveOrHarvest() public {
        (, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.5 ether);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        bytes32 poolId = vault.lpPoolId(key);
        _executeLp(vault, key, 0);
        vm.prank(manager);
        vault.addLiquidity(key, -600, 600, 0.1 ether, 0.1 ether, 0.1 ether);
        assetA.transfer(address(poolManager), 0.01 ether);
        weth.transfer(address(poolManager), 0.01 ether);
        poolManager.setFees(poolId, 0.01 ether, 0.01 ether);

        vm.prank(manager);
        vault.setSwapsPaused(true);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Paused.selector);
        vault.addLiquidity(key, -600, 600, 0.1 ether, 0.1 ether, 0.1 ether);
        // Harvest still works while paused.
        vm.warp(vm.getBlockTimestamp() + 7 days);
        vm.prank(manager);
        (uint256 got0, uint256 got1) = vault.harvestFees(key);
        assertEq(got0 + got1, 0.02 ether);
        // Removal still works while paused.
        vm.prank(manager);
        vault.removeLiquidity(key, 0.1 ether, 0.1 ether, 0.1 ether);
        assertEq(vault.lpValue(), 0);
    }

    // --- Harvest cadence ---

    function test_harvestTooSoon_thenDue() public {
        (, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.5 ether);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        bytes32 poolId = vault.lpPoolId(key);
        _executeLp(vault, key, 0);
        vm.prank(manager);
        vault.addLiquidity(key, -600, 600, 0.1 ether, 0.1 ether, 0.1 ether);
        assertTrue(vault.harvestDue(poolId)); // first harvest is due (never harvested)
        assetA.transfer(address(poolManager), 0.01 ether);
        weth.transfer(address(poolManager), 0.01 ether);
        poolManager.setFees(poolId, 0.01 ether, 0.01 ether);
        vm.prank(manager);
        vault.harvestFees(key);
        assertFalse(vault.harvestDue(poolId));
        vm.warp(vm.getBlockTimestamp() + 6 days);
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpHarvestTooSoon.selector);
        vault.harvestFees(key);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        assertTrue(vault.harvestDue(poolId));
        assetA.transfer(address(poolManager), 0.005 ether);
        weth.transfer(address(poolManager), 0.005 ether);
        poolManager.setFees(poolId, 0.005 ether, 0.005 ether);
        vm.prank(manager);
        (uint256 got0, uint256 got1) = vault.harvestFees(key);
        assertEq(got0 + got1, 0.01 ether);
    }

    function test_zeroFeeHarvest_doesNotStartClock() public {
        (, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.5 ether);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        _executeLp(vault, key, 0);
        vm.prank(manager);
        vault.addLiquidity(key, -600, 600, 0.1 ether, 0.1 ether, 0.1 ether);
        vm.prank(manager);
        (uint256 got0, uint256 got1) = vault.harvestFees(key);
        assertEq(got0 + got1, 0);
        // No fees accrued, so the clock did not start: a harvest right after still works.
        assetA.transfer(address(poolManager), 0.01 ether);
        weth.transfer(address(poolManager), 0.01 ether);
        poolManager.setFees(vault.lpPoolId(key), 0.01 ether, 0.01 ether);
        vm.prank(manager);
        (got0, got1) = vault.harvestFees(key);
        assertEq(got0 + got1, 0.02 ether);
    }

    // --- Exits are never blocked by LP state ---

    function test_exitDuringLpWait() public {
        (FundNFTPhase3 nft, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.5 ether);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        vm.prank(manager);
        vault.proposeLiquidity(key, -600, 600, 0, "POLYDASH/WETH earns fees", "ipfs://thesis-lp");
        // The buyer exits one of two shares mid-wait and receives half the liquid holdings.
        uint256[] memory ids = new uint256[](1);
        ids[0] = 2;
        vm.prank(buyer);
        nft.exit(ids);
        assertEq(nft.balanceOf(buyer), 0);
        assertEq(IERC20(address(assetA)).balanceOf(buyer), 0.25 ether);
        assertEq(IERC20(address(weth)).balanceOf(buyer), 0.25 ether);
    }

    function test_readdAfterFullRemoval_doesNotDoubleCount() public {
        (, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.5 ether);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        bytes32 poolId = vault.lpPoolId(key);
        _executeLp(vault, key, 0);
        vm.prank(manager);
        vault.addLiquidity(key, -600, 600, 0.1 ether, 0.1 ether, 0.1 ether);
        assertEq(vault.lpPoolCount(), 1);
        vm.prank(manager);
        vault.removeLiquidity(key, 0.1 ether, 0.1 ether, 0.1 ether);
        assertEq(vault.lpValue(), 0);
        // Re-add to the same pool: the pool id must not be listed twice, or
        // lpValue() would double-count the position.
        vm.prank(manager);
        vault.addLiquidity(key, -600, 600, 0.1 ether, 0.1 ether, 0.1 ether);
        assertEq(vault.lpPoolCount(), 1);
        assertEq(vault.lpValue(), 0.2 ether);
        assertEq(vault.nav(), EXPECTED_NAV);
    }

    function test_removeMoreThanPosition_reverts() public {
        (, FundVaultPhase3V3 vault) = _open();
        _fundLpTokens(vault, 0.5 ether);
        FundLiquidityStore.LpPoolKey memory key = _key(address(assetA));
        _executeLp(vault, key, 0);
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpNoPosition.selector);
        vault.removeLiquidity(key, 0.1 ether, 0, 0);
        vm.prank(manager);
        vault.addLiquidity(key, -600, 600, 0.1 ether, 0.1 ether, 0.1 ether);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadAmount.selector);
        vault.removeLiquidity(key, 0.2 ether, 0, 0);
        vm.prank(manager);
        vm.expectRevert(FundLiquidityStore.LpNoPosition.selector);
        vault.harvestFees(_key(address(assetB)));
    }

    // --- Stake-facet slot ---

    function test_stakeSlot_setOnce_andTypedEntries() public {
        (, FundVaultPhase3V3 vault) = _open();
        // No facet yet: typed entries revert.
        vm.prank(manager);
        vm.expectRevert(FundVaultPhase3V3.StakeFacetNotSet.selector);
        vault.stake(address(0x1234), 1 ether);
        vm.prank(manager);
        vm.expectRevert(FundVaultPhase3V3.StakeFacetNotSet.selector);
        vault.unstake(address(0x1234), 1);
        vm.prank(manager);
        vm.expectRevert(FundVaultPhase3V3.StakeFacetNotSet.selector);
        vault.unstakeAll(address(0x1234));
        vm.prank(manager);
        vm.expectRevert(FundVaultPhase3V3.StakeFacetNotSet.selector);
        vault.claimRewards(address(0x1234), 0);
        // Non-manager cannot set it.
        MockStakeFacet mock = new MockStakeFacet();
        vm.prank(buyer);
        vm.expectRevert(FundVaultStore.NotManager.selector);
        vault.setStakeFacet(address(mock));
        // Manager sets it once; typed entries delegatecall it. The mock stubs are
        // no-ops: a delegatecalled facet must not write storage, so the test can
        // only assert the wiring does not revert.
        vm.prank(manager);
        vault.setStakeFacet(address(mock));
        assertEq(vault.stakeFacet(), address(mock));
        vm.prank(manager);
        vault.stake(address(0x1234), 1 ether);
        vm.prank(manager);
        vault.unstake(address(0x1234), 1);
        vm.prank(manager);
        vault.unstakeAll(address(0x1234));
        vm.prank(manager);
        vault.claimRewards(address(0x1234), 0);
        // A second set reverts.
        vm.prank(manager);
        vm.expectRevert(FundVaultPhase3V3.StakeFacetAlreadySet.selector);
        vault.setStakeFacet(address(mock));
        // A code-less address cannot be set.
        (, FundVaultPhase3V3 vault2) = _open();
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadRouter.selector);
        vault2.setStakeFacet(address(0x1234));
    }

    function test_factory_wiring() public {
        assertEq(factory.liquidityFacet(), address(facet));
        assertEq(factory.stakeFacet(), address(0));
        assertEq(factory.poolManager(), address(poolManager));
        (, FundVaultPhase3V3 vault) = _open();
        assertEq(vault.liquidityFacet(), address(facet));
        assertEq(vault.stakeFacet(), address(0));
        assertEq(vault.lpPoolManager(), address(poolManager));
        assertEq(vault.swapFacet(), factory.swapFacet());
    }
}
