// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundAllowlist} from "../../../src/fund/phase2/Interfaces.sol";
import {FundVaultStore} from "../../../src/fund/phase2/FundVaultStore.sol";
import {FundPhase3Store} from "../../../src/fund/phase3/FundPhase3Store.sol";
import {FundProposalStore} from "../../../src/fund/phase3/FundProposalStore.sol";
import {FundLiquidityStore} from "../../../src/fund/phase3/FundLiquidityStore.sol";
import {FundStakeFacetPhase3, FundStakeStore, IStakingPool} from "../../../src/fund/phase3/FundStakeFacetPhase3.sol";
import {PolydashStakingFactoryV2} from "../../../src/v2/PolydashStakingFactoryV2.sol";
import {PolydashStakingPoolV2} from "../../../src/v2/PolydashStakingPoolV2.sol";
import {MockERC20} from "../../mocks/MockERC20.sol";
import {MockWETH} from "../InvestMocks.sol";

/// @notice 1:1 quote allowlist stub: every asset is allowed, price is 1 ETH per token.
///         Only used so the facet's position-cap check can run.
contract MockStakeAllowlist is IFundAllowlist {
    function paused() external pure returns (bool) {
        return false;
    }

    function delay() external pure returns (uint256) {
        return 1 days;
    }

    function routerAllowed(address) external pure returns (bool) {
        return false;
    }

    function assetAllowed(address) external pure returns (bool) {
        return true;
    }

    function quoteAsset() external pure returns (address) {
        return address(0);
    }

    function feedOf(address)
        external
        pure
        returns (address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)
    {
        return (address(0), 0, 0, 0);
    }

    function quote(address, uint256 amount) external pure returns (uint256) {
        return amount;
    }

    function checkPrice(address) external pure {}
}

/// @notice Model-2 fee-on-transfer token: the SENDER is debited amount + tax on every transfer.
///         This is the token model that froze naive claims before the Nov 11 fix (the recipient
///         still receives the full `amount`; the pool pays the tax on top).
contract Model2FoTToken is ERC20 {
    uint256 public taxBps;

    constructor(string memory n, string memory s, uint256 _taxBps) ERC20(n, s) {
        taxBps = _taxBps;
        _mint(msg.sender, 1e30);
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (taxBps > 0 && from != address(0) && to != address(0)) {
            uint256 tax = (value * taxBps) / 10_000;
            super._update(from, address(0xdead), tax);
        }
    }
}

/// @notice Minimal staking pool WITH the FoT fix (`claimAmount` + learned `rewardOutFeeBps`),
///         mirroring the fixed `PolydashStakingPoolV2` claim path. Rewards accrue linearly per
///         share; the reward token may be a model-2 FoT token. Test-only.
contract MockFixedPool is IStakingPool {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    address public stakeToken;
    address public rewardToken;
    uint256 public claimFeeBps;
    uint256 public rewardRate; // reward tokens per second (1e18 scale)
    uint256 public rewardPerShare; // 1e18 scale
    uint256 public lastUpdate;
    uint256 public endTime;
    bool public funded;
    uint256 public totalStaked;
    uint256 public rewardOutFeeBps; // learned sender-side reward-token fee, like the fixed pool
    uint256 public claimAmountCalls;
    uint256 public claimCalls;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userPaid;
    mapping(address => uint256) public rewardsAccrued;

    constructor(address _stake, address _reward, uint256 _claimFeeBps) {
        stakeToken = _stake;
        rewardToken = _reward;
        claimFeeBps = _claimFeeBps;
        lastUpdate = block.timestamp;
    }

    function fund(uint256 rewards, uint256 duration) external {
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), rewards);
        rewardRate = rewards / duration;
        endTime = block.timestamp + duration;
        funded = true;
    }

    function stake(uint256 amount) external {
        require(funded && block.timestamp < endTime, "pool");
        _update(msg.sender);
        IERC20(stakeToken).safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        totalStaked += amount;
    }

    function withdraw(uint256 shares) external {
        require(shares <= balanceOf[msg.sender], "bal");
        _update(msg.sender);
        balanceOf[msg.sender] -= shares;
        totalStaked -= shares;
        IERC20(stakeToken).safeTransfer(msg.sender, shares);
    }

    function claim() external {
        claimCalls += 1;
        _claim(type(uint256).max);
    }

    function claimAmount(uint256 grossAmount) external {
        require(grossAmount > 0, "zero");
        claimAmountCalls += 1;
        _claim(grossAmount);
    }

    function earned(address account) external view returns (uint256) {
        uint256 perShare = rewardPerShare;
        if (totalStaked > 0 && block.timestamp > lastUpdate) {
            uint256 until = block.timestamp < endTime ? block.timestamp : endTime;
            if (until > lastUpdate) perShare += ((until - lastUpdate) * rewardRate * 1e18) / totalStaked;
        }
        return rewardsAccrued[account] + (balanceOf[account] * (perShare - userPaid[account])) / 1e18;
    }

    function sharesToAmount(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function _update(address account) internal {
        if (totalStaked > 0 && block.timestamp > lastUpdate) {
            uint256 until = block.timestamp < endTime ? block.timestamp : endTime;
            if (until > lastUpdate) {
                rewardPerShare += ((until - lastUpdate) * rewardRate * 1e18) / totalStaked;
                lastUpdate = until;
            }
        }
        if (account != address(0)) {
            rewardsAccrued[account] += (balanceOf[account] * (rewardPerShare - userPaid[account])) / 1e18;
            userPaid[account] = rewardPerShare;
        }
    }

    /// @notice Mirrors the fixed pool's `_claim`: gross is capped to what is earned, the net is
    ///         capped so the REAL outflow (net + sender-side token fee) fits the reward balance,
    ///         and the fee rate is learned from observed outflows. Pays nothing rather than reverting.
    function _claim(uint256 maxGross) internal {
        _update(msg.sender);
        uint256 gross = rewardsAccrued[msg.sender];
        if (gross > maxGross) gross = maxGross;
        if (gross == 0) return;
        uint256 fee = (gross * claimFeeBps) / BPS;
        uint256 net = gross - fee;
        uint256 avail = IERC20(rewardToken).balanceOf(address(this));
        uint256 maxNet = (avail * BPS) / (BPS + rewardOutFeeBps);
        if (net > maxNet) {
            net = maxNet;
            gross = (net * BPS) / (BPS - claimFeeBps);
            fee = gross - net;
        }
        if (net == 0) return;
        rewardsAccrued[msg.sender] -= gross;
        uint256 before = IERC20(rewardToken).balanceOf(address(this));
        IERC20(rewardToken).safeTransfer(msg.sender, net);
        uint256 out = before - IERC20(rewardToken).balanceOf(address(this));
        if (out > net) {
            uint256 feeBps = ((out - net) * BPS) / net;
            if (feeBps > rewardOutFeeBps) rewardOutFeeBps = feeBps;
        }
    }
}

/// @notice Test-controlled factory stub: `isPool` is set explicitly. Used so a mock pool with
///         the fixed `claimAmount` surface can pass the facet's provenance check in tests.
contract MockStakingFactory {
    mapping(address => bool) public isPool;

    function setPool(address pool, bool v) external {
        isPool[pool] = v;
    }
}

/// @title StakeFacetHarness (test-only)
/// @notice Minimal V3-vault stand-in: the same storage prefix as the facet
///         (`FundVaultStore`, `FundPhase3Store`, `FundProposalStore`, `FundLiquidityStore`,
///         `FundStakeStore`), a `stakeFacet` storage slot in the same position as the real V3
///         vault's, and entry points that delegatecall the facet exactly the way the real V3
///         vault will (see the wiring spec in the build log). Test-only helpers mutate status /
///         pause / caps / magic so the facet's guards can be exercised.
contract StakeFacetHarness is
    ReentrancyGuard,
    FundVaultStore,
    FundPhase3Store,
    FundProposalStore,
    FundLiquidityStore,
    FundStakeStore
{
    /// @notice Storage slot, like the V3 vault's `stakeFacet` (set at construction here).
    address public stakeFacet;

    constructor(
        address _manager,
        address _allowlist,
        address _weth,
        address _stakeToken,
        address _factory,
        address _legacyFactory,
        address _facet,
        uint256 _maxPositionBps,
        bool _inMandate
    ) {
        stakeFacet = _facet;
        manager = _manager;
        allowlist = IFundAllowlist(_allowlist);
        weth = _weth;
        stakeToken = _stakeToken;
        stakingFactory = _factory;
        legacyStakingFactory = _legacyFactory;
        stakeMagic = STAKE_MAGIC;
        status = Status.Investing;
        maxPositionBps = _maxPositionBps;
        maxTradeBps = 7500;
        maxDeviationBps = 5000;
        if (_inMandate) {
            inMandate[_stakeToken] = true;
            sellable[_stakeToken] = true;
            _mandateAssets.push(_stakeToken);
        }
    }

    receive() external payable {}

    function stake(address pool, uint256 amount) external nonReentrant {
        (bool ok, bytes memory ret) =
            stakeFacet.delegatecall(abi.encodeWithSelector(FundStakeFacetPhase3.stake.selector, pool, amount));
        if (!ok) _bubble(ret);
    }

    function unstake(address pool, uint256 shares) external nonReentrant {
        (bool ok, bytes memory ret) =
            stakeFacet.delegatecall(abi.encodeWithSelector(FundStakeFacetPhase3.unstake.selector, pool, shares));
        if (!ok) _bubble(ret);
    }

    function unstakeAll(address pool) external nonReentrant {
        (bool ok, bytes memory ret) =
            stakeFacet.delegatecall(abi.encodeWithSelector(FundStakeFacetPhase3.unstakeAll.selector, pool));
        if (!ok) _bubble(ret);
    }

    function claimRewards(address pool, uint256 maxGross) external nonReentrant {
        (bool ok, bytes memory ret) =
            stakeFacet.delegatecall(abi.encodeWithSelector(FundStakeFacetPhase3.claimRewards.selector, pool, maxGross));
        if (!ok) _bubble(ret);
    }

    // --- facet view passthroughs (implemented by reading vault storage directly, exactly as
    //     the real V3 vault's nav() must: Solidity forbids delegatecall inside a view function,
    //     so a view can never reach the facet — the vault inlines this computation) ---
    function stakedPools() external view returns (address[] memory) {
        return _stakedPools;
    }

    function stakedAmount(address pool) external view returns (uint256) {
        return IStakingPool(pool).sharesToAmount(IStakingPool(pool).balanceOf(address(this)));
    }

    function stakedValueEth(address pool) external view returns (uint256) {
        return
            allowlist.quote(stakeToken, IStakingPool(pool).sharesToAmount(IStakingPool(pool).balanceOf(address(this))));
    }

    function earnedRewards(address pool) external view returns (uint256) {
        return IStakingPool(pool).earned(address(this));
    }

    // --- test-only mutation helpers (not part of the V3 vault) ---
    function setPaused(bool v) external {
        swapsPaused = v;
    }

    function setStatus(Status s) external {
        status = s;
    }

    function setAssetCap(address asset, uint256 cap) external {
        assetCap[asset] = cap;
    }

    function setMagic(bytes32 m) external {
        stakeMagic = m;
    }

    function setMandate(address asset, bool v) external {
        inMandate[asset] = v;
        // Keep `_mandateAssets` in step: nav() values only listed assets, so adding to the
        // mandate without listing would undercount NAV and trip the position cap.
        if (v) {
            bool listed;
            uint256 n = _mandateAssets.length;
            for (uint256 i; i < n; ++i) {
                if (_mandateAssets[i] == asset) listed = true;
            }
            if (!listed) _mandateAssets.push(asset);
        }
    }

    function _bubble(bytes memory ret) internal pure {
        if (ret.length == 0) revert("facet");
        assembly {
            revert(add(ret, 32), mload(ret))
        }
    }
}

/// @title StakeFacetTest (not reviewed, not deployed)
/// @notice Unit tests for `FundStakeFacetPhase3` via `StakeFacetHarness`. Real pre-fix
///         `PolydashStakingPoolV2` pools (this worktree's code) exercise the `claim()` fallback;
///         `MockFixedPool` exercises the `claimAmount()` path against a model-2 FoT reward token.
contract StakeFacetTest is Test {
    MockERC20 polydash;
    MockERC20 otherReward;
    Model2FoTToken fotReward;
    MockWETH weth;
    MockStakeAllowlist allow;
    PolydashStakingFactoryV2 factory;
    PolydashStakingFactoryV2 otherFactory;
    MockStakingFactory mockFactory;
    FundStakeFacetPhase3 facet;

    address manager = makeAddr("manager");
    address stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(1_760_000_000);
        polydash = new MockERC20("POLYDASH", "POLYDASH", 0);
        otherReward = new MockERC20("Other", "OTH", 0);
        fotReward = new Model2FoTToken("FoT", "FOT", 500); // 5% sender-side tax
        weth = new MockWETH();
        allow = new MockStakeAllowlist();
        factory = new PolydashStakingFactoryV2(address(this));
        otherFactory = new PolydashStakingFactoryV2(address(this));
        mockFactory = new MockStakingFactory();
        facet = new FundStakeFacetPhase3();
    }

    // --- helpers ---

    function _harness(uint256 maxPositionBps, bool inMandate) internal returns (StakeFacetHarness h) {
        return _harnessWithFactories(maxPositionBps, inMandate, address(factory), address(factory));
    }

    function _harnessWithFactories(uint256 maxPositionBps, bool inMandate, address factoryAddr, address legacyAddr)
        internal
        returns (StakeFacetHarness h)
    {
        return _harnessCustom(address(polydash), maxPositionBps, inMandate, factoryAddr, legacyAddr);
    }

    function _harnessCustom(
        address stakeTokenAddr,
        uint256 maxPositionBps,
        bool inMandate,
        address factoryAddr,
        address legacyAddr
    ) internal returns (StakeFacetHarness h) {
        h = new StakeFacetHarness(
            manager,
            address(allow),
            address(weth),
            stakeTokenAddr,
            factoryAddr,
            legacyAddr,
            address(facet),
            maxPositionBps,
            inMandate
        );
        vm.deal(address(h), 100 ether);
        IERC20(stakeTokenAddr).transfer(address(h), 100 ether);
    }

    /// @notice Real (pre-fix, worktree) pool: stake == reward == POLYDASH, 100k rewards over 10 days, 1% fee.
    function _realPool() internal returns (PolydashStakingPoolV2 pool) {
        polydash.approve(address(factory), type(uint256).max);
        pool = PolydashStakingPoolV2(
            factory.createPool(address(polydash), address(polydash), 100_000 ether, 0, 10 days, 0, 100, "PD Pool", "d")
        );
    }

    // --- happy path (real pre-fix pool: claim() fallback) ---

    function test_stake_claim_unstake_realPool() public {
        StakeFacetHarness h = _harness(8000, true);
        PolydashStakingPoolV2 pool = _realPool();

        vm.prank(manager);
        h.stake(address(pool), 10 ether);
        assertEq(h.stakedShares(address(pool)), 10 ether);
        assertEq(pool.balanceOf(address(h)), 10 ether);
        assertEq(polydash.balanceOf(address(h)), 90 ether);
        assertEq(h.stakedPools().length, 1);

        vm.warp(block.timestamp + 5 days);
        uint256 earned = pool.earned(address(h));
        assertGt(earned, 40_000 ether);

        uint256 before = polydash.balanceOf(address(h));
        vm.prank(manager);
        h.claimRewards(address(pool), 0);
        uint256 received = polydash.balanceOf(address(h)) - before;
        assertGt(received, 40_000 ether); // full claim arrived via the claim() fallback

        vm.prank(manager);
        h.unstake(address(pool), 4 ether);
        assertEq(h.stakedShares(address(pool)), 6 ether);
        assertEq(polydash.balanceOf(address(h)), before + received + 4 ether);

        vm.prank(manager);
        h.unstakeAll(address(pool));
        assertEq(h.stakedShares(address(pool)), 0);
        assertEq(pool.balanceOf(address(h)), 0);
        assertEq(h.stakedPools().length, 0);
        assertEq(polydash.balanceOf(address(h)), 100 ether + received); // principal whole + rewards
    }

    // --- pool approval ---

    function test_stake_rejects_pool_not_from_approved_factory() public {
        StakeFacetHarness h = _harness(8000, true);
        // A mock pool the factory never created, even though it implements the interface.
        MockFixedPool fake = new MockFixedPool(address(polydash), address(polydash), 100);
        vm.prank(manager);
        vm.expectRevert(FundStakeStore.NotStakingPool.selector);
        h.stake(address(fake), 1 ether);
    }

    function test_stake_rejects_pool_from_other_factory_instance() public {
        StakeFacetHarness h = _harness(8000, true);
        // A REAL pool, but from a factory the vault does not trust.
        polydash.approve(address(otherFactory), type(uint256).max);
        address pool =
            otherFactory.createPool(address(polydash), address(polydash), 1000 ether, 0, 10 days, 0, 100, "x", "d");
        vm.prank(manager);
        vm.expectRevert(FundStakeStore.NotStakingPool.selector);
        h.stake(pool, 1 ether);
    }

    function test_stake_rejects_wrong_stake_token() public {
        StakeFacetHarness h = _harness(8000, true);
        MockERC20 wrong = new MockERC20("Wrong", "WRG", 0);
        wrong.approve(address(factory), type(uint256).max);
        address pool = factory.createPool(address(wrong), address(wrong), 1000 ether, 0, 10 days, 0, 100, "x", "d");
        vm.prank(manager);
        vm.expectRevert(FundStakeStore.NotStakingPool.selector);
        h.stake(pool, 1 ether);
    }

    function test_stake_rejects_unsupported_reward_token() public {
        StakeFacetHarness h = _harness(8000, true);
        polydash.approve(address(factory), type(uint256).max);
        otherReward.approve(address(factory), type(uint256).max);
        address pool =
            factory.createPool(address(polydash), address(otherReward), 1000 ether, 0, 10 days, 0, 100, "x", "d");
        vm.prank(manager);
        vm.expectRevert(FundStakeStore.UnsupportedReward.selector);
        h.stake(pool, 1 ether);
    }

    function test_stake_accepts_weth_reward_pool() public {
        StakeFacetHarness h = _harness(8000, true);
        weth.deposit{value: 100 ether}();
        weth.approve(address(factory), type(uint256).max);
        address pool = factory.createPool(address(polydash), address(weth), 100 ether, 0, 10 days, 0, 100, "x", "d");
        vm.prank(manager);
        h.stake(pool, 1 ether);
        assertEq(h.stakedShares(pool), 1 ether);
    }

    // --- mandate / auth / layout ---

    function test_stake_requires_mandate() public {
        StakeFacetHarness h = _harness(8000, false);
        PolydashStakingPoolV2 pool = _realPool();
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotInMandate.selector);
        h.stake(address(pool), 1 ether);
        // Adding POLYDASH to the mandate (as an executed proposal would) unblocks staking.
        h.setMandate(address(polydash), true);
        vm.prank(manager);
        h.stake(address(pool), 1 ether);
        assertEq(h.stakedShares(address(pool)), 1 ether);
    }

    function test_nonManager_cannot_stake_unstake_claim() public {
        StakeFacetHarness h = _harness(8000, true);
        PolydashStakingPoolV2 pool = _realPool();
        vm.prank(stranger);
        vm.expectRevert(FundVaultStore.NotAuthorized.selector);
        h.stake(address(pool), 1 ether);
        vm.prank(manager);
        h.stake(address(pool), 1 ether);
        vm.prank(stranger);
        vm.expectRevert(FundVaultStore.NotAuthorized.selector);
        h.unstake(address(pool), 1 ether);
        vm.prank(stranger);
        vm.expectRevert(FundVaultStore.NotAuthorized.selector);
        h.claimRewards(address(pool), 0);
    }

    function test_direct_facet_call_reverts() public {
        PolydashStakingPoolV2 pool = _realPool();
        vm.expectRevert(FundVaultStore.DirectFacetCall.selector);
        facet.stake(address(pool), 1 ether);
        vm.expectRevert(FundVaultStore.DirectFacetCall.selector);
        facet.unstake(address(pool), 1 ether);
        vm.expectRevert(FundVaultStore.DirectFacetCall.selector);
        facet.claimRewards(address(pool), 0);
    }

    function test_wrong_layout_magic_reverts() public {
        StakeFacetHarness h = _harness(8000, true);
        PolydashStakingPoolV2 pool = _realPool();
        h.setMagic(bytes32(uint256(1)));
        vm.prank(manager);
        vm.expectRevert(FundStakeStore.StakeLayout.selector);
        h.stake(address(pool), 1 ether);
    }

    function test_stake_requires_investing() public {
        StakeFacetHarness h = _harness(8000, true);
        PolydashStakingPoolV2 pool = _realPool();
        h.setStatus(FundVaultStore.Status.RaisingClosed);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotInvesting.selector);
        h.stake(address(pool), 1 ether);
    }

    // --- position cap ---

    function test_stake_position_cap() public {
        // Staking moves POLYDASH vault -> pool; the total position (liquid + staked) never
        // changes, so the cap binds exactly when the position was ALREADY over it. NAV = 100 ETH
        // + 100 POLYDASH @1:1 = 200; the 30% proposal cap allows 60, but the position is 100.
        StakeFacetHarness h = _harness(8000, true);
        PolydashStakingPoolV2 pool = _realPool();
        // Under the strategy cap alone (80% -> 160) staking is fine.
        vm.prank(manager);
        h.stake(address(pool), 50 ether);
        assertEq(h.stakedShares(address(pool)), 50 ether);
        // Tighten the cap below the existing position: the next stake must fail closed.
        h.setAssetCap(address(polydash), 3000);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.PositionCap.selector);
        h.stake(address(pool), 1 ether);
        assertEq(h.stakedShares(address(pool)), 50 ether);
    }

    // --- outflow-aware claims (mock fixed pool + model-2 FoT reward) ---

    function test_claimAmount_partial_and_full_with_fot_reward() public {
        // Stake token AND reward token are the SAME model-2 FoT token: the facet accepts it
        // (reward == stakeToken) while the claim path still faces a 5% sender-side tax on every
        // payout. A FoT token that is neither the stake token nor WETH is rejected by design
        // (see test_stake_rejects_unsupported_reward_token), so the FoT claim test must use a
        // same-token pool — the realistic case for a POLYDASH/POLYDASH pool.
        MockFixedPool pool = new MockFixedPool(address(fotReward), address(fotReward), 100);
        fotReward.approve(address(pool), type(uint256).max);
        pool.fund(100_000 ether, 10 days);
        mockFactory.setPool(address(pool), true);
        StakeFacetHarness h = _harnessCustom(address(fotReward), 8000, true, address(mockFactory), address(0));
        vm.prank(manager);
        h.stake(address(pool), 10 ether);
        vm.warp(block.timestamp + 5 days);
        uint256 earned = pool.earned(address(h));
        assertGt(earned, 40_000 ether);

        // Partial claim via claimAmount: the vault receives ~0.99 ether (1 ether gross, 1% fee).
        uint256 before = fotReward.balanceOf(address(h));
        vm.prank(manager);
        h.claimRewards(address(pool), 1 ether);
        uint256 received = fotReward.balanceOf(address(h)) - before;
        assertEq(pool.claimAmountCalls(), 1);
        assertEq(pool.claimCalls(), 0);
        assertGt(received, 0.9 ether);
        assertLt(received, 1 ether);

        // Full claim still succeeds despite the 5% sender-side tax: the pool sizes the payout
        // outflow-aware instead of reverting, and learns the fee rate.
        before = fotReward.balanceOf(address(h));
        vm.prank(manager);
        h.claimRewards(address(pool), 0);
        received = fotReward.balanceOf(address(h)) - before;
        assertGt(received, 40_000 ether);
        assertGt(pool.rewardOutFeeBps(), 0);
        assertLt(pool.earned(address(h)), 1 ether); // dust at most
    }

    function test_claim_with_no_rewards_reverts() public {
        StakeFacetHarness h = _harness(8000, true);
        PolydashStakingPoolV2 pool = _realPool();
        vm.prank(manager);
        h.stake(address(pool), 1 ether);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NothingToWithdraw.selector);
        h.claimRewards(address(pool), 0);
    }

    // --- exits are never blocked ---

    function test_unstake_and_claim_never_blocked_by_pause() public {
        StakeFacetHarness h = _harness(8000, true);
        PolydashStakingPoolV2 pool = _realPool();
        vm.prank(manager);
        h.stake(address(pool), 10 ether);
        vm.warp(block.timestamp + 5 days);
        h.setPaused(true);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Paused.selector);
        h.stake(address(pool), 1 ether); // new stakes ARE paused, like buys
        vm.prank(manager);
        h.claimRewards(address(pool), 0); // claims are not
        uint256 claimed = polydash.balanceOf(address(h)) - 90 ether;
        assertGt(claimed, 0);
        vm.prank(manager);
        h.unstake(address(pool), 10 ether); // unstaking is not
        assertEq(polydash.balanceOf(address(h)), 100 ether + claimed);
        assertEq(h.stakedShares(address(pool)), 0);
    }

    function test_unstake_never_blocked_by_status() public {
        StakeFacetHarness h = _harness(8000, true);
        PolydashStakingPoolV2 pool = _realPool();
        vm.prank(manager);
        h.stake(address(pool), 10 ether);
        h.setStatus(FundVaultStore.Status.Failed);
        vm.prank(manager);
        h.unstakeAll(address(pool));
        assertEq(h.stakedShares(address(pool)), 0);
        assertEq(pool.balanceOf(address(h)), 0);
    }

    // --- exit-while-staked: staked value is NOT in the vault (in-kind shortfall) ---

    function test_exit_while_staked_sees_only_liquid_balance() public {
        StakeFacetHarness h = _harness(8000, true);
        PolydashStakingPoolV2 pool = _realPool();
        vm.prank(manager);
        h.stake(address(pool), 10 ether);
        // The vault's liquid POLYDASH is 90 ether; the other 10 ether sits in the pool.
        // `_settle()` pays exits from vault balances only, so an exit right now pays the
        // liquid share only — the staked share stays in the fund for remaining holders.
        assertEq(polydash.balanceOf(address(h)), 90 ether);
        assertEq(h.stakedAmount(address(pool)), 10 ether);
        assertEq(h.stakedValueEth(address(pool)), 10 ether);
        assertEq(h.earnedRewards(address(pool)), 0);
        // After unstaking, the whole position is liquid again and exit-payable.
        vm.prank(manager);
        h.unstakeAll(address(pool));
        assertEq(polydash.balanceOf(address(h)), 100 ether);
        assertEq(h.stakedAmount(address(pool)), 0);
    }

    // --- views ---

    function test_staked_views() public {
        StakeFacetHarness h = _harness(8000, true);
        PolydashStakingPoolV2 pool = _realPool();
        vm.prank(manager);
        h.stake(address(pool), 10 ether);
        vm.warp(block.timestamp + 1 days);
        assertEq(h.stakedPools()[0], address(pool));
        assertEq(h.stakedAmount(address(pool)), 10 ether);
        assertEq(h.stakedValueEth(address(pool)), 10 ether);
        assertGt(h.earnedRewards(address(pool)), 9000 ether);
    }
}
