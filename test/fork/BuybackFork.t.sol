// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PolydashBuybackVault as V} from "../../src/buyback/PolydashBuybackVault.sol";
import {MockRewardsPool} from "../buyback/Mocks.sol";
import {PolydashRewardsPool as RP} from "../../src/buyback/PolydashRewardsPool.sol";

interface IFactory {
    function setBuybackConfig(bool, uint256, address) external;
    function buybackEnabled() external view returns (bool);
    function buybackBps() external view returns (uint256);
    function buybackContract() external view returns (address);
    function collectPlatformFees(address) external returns (uint256);
    function owner() external view returns (address);
    function platformFeeWallet() external view returns (address);
}

interface ILaunch {
    function platformFeesAccrued() external view returns (uint256);
    function buy(uint256) external payable returns (uint256);
}

interface IWETH {
    function deposit() external payable;
    function transfer(address, uint256) external returns (bool);
}

interface IPool2 {
    function endTime() external view returns (uint256);
    function rewardToken() external view returns (address);
    function stakeToken() external view returns (address);
}

/// Swaps on the real POLYDASH pool to move the price (the whale).
contract Whale is IUnlockCallback {
    IPoolManager pm;
    PoolKey key;

    constructor(IPoolManager _pm, PoolKey memory k) {
        pm = _pm;
        key = k;
    }

    function buyPoly(uint256 wethIn) external payable {
        pm.unlock(abi.encode(wethIn));
    }

    function unlockCallback(bytes calldata d) external returns (bytes memory) {
        uint256 a = abi.decode(d, (uint256));
        BalanceDelta r = pm.swap(key, IPoolManager.SwapParams(true, -int256(a), TickMath.MIN_SQRT_PRICE + 1), "");
        uint256 owed = uint256(int256(-r.amount0()));
        address w = Currency.unwrap(key.currency0);
        IWETH(w).deposit{value: owed}();
        pm.sync(key.currency0);
        IWETH(w).transfer(address(pm), owed);
        pm.settle();
        pm.take(key.currency1, address(this), uint256(int256(r.amount1())));
        return "";
    }
    receive() external payable {}
}

/// FORK_RPC=https://rpc.mainnet.chain.robinhood.com forge test --match-contract Fork -vv
contract ForkBuyback is Test {
    address constant LF_A = 0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2;
    address constant LF_B = 0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2;
    address constant L_A = 0x25D1049133e4647672880F513Ad1aeBCC4E150A8; // launch on LF_A
    address constant MOON_LAUNCH = 0xB023689Bc81A4A54026441842346Cc29C3f10527; // launch on LF_B
    address constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address constant HOOK = 0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc;
    address constant STAKING_V2 = 0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0;
    address constant FEES = 0x9a21c75aC263cC43125E70200636f6397f8776d0;
    address constant ADMIN = 0x89df38Df79C0a7E96214c596ceF5773d2ac353F1;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address constant POLY_POOL_V2 = 0x0F50043E172B8652bb786C4F14f30c415E5760AB;

    V v;
    RP pool;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        // Deployed contracts (admin nonces 49 and 50, Sourcify verified).
        pool = RP(0x608d106Bb58A804fcd45823e0C6087801dee2aCa);
        v = V(payable(0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193));
        assertGt(address(v).code.length, 0, "vault not deployed on this fork");
    }

    function _config() internal {
        vm.startPrank(FEES);
        IFactory(LF_A).setBuybackConfig(true, 4000, address(v));
        IFactory(LF_B).setBuybackConfig(true, 4000, address(v));
        vm.stopPrank();
    }

    function test_fork_full_flow() public {
        console2.log("pool (nonce 49)", address(pool));
        console2.log("vault (nonce 50)", address(v));
        assertEq(v.rewardsTarget(), address(pool));
        assertTrue(v.targetActive());
        console2.log("poolId");
        console2.logBytes32(v.poolId());
        console2.log("spot sqrtP", v.spotSqrtPriceX96());
        console2.log("poolFeeBps (pairedFee+protocolFee)", v.poolFeeBps());
        assertEq(v.poolFeeBps(), 120);

        _config();
        assertTrue(IFactory(LF_A).buybackEnabled());
        assertEq(IFactory(LF_B).buybackBps(), 4000);
        assertEq(IFactory(LF_B).buybackContract(), address(v));

        // generate some extra fees on MOON so amounts are visible, then collect real fees from both launches
        address trader = address(0x7EAD);
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        try ILaunch(MOON_LAUNCH).buy{value: 0.01 ether}(0) {} catch {}
        uint256 accA = ILaunch(L_A).platformFeesAccrued();
        uint256 accB = ILaunch(MOON_LAUNCH).platformFeesAccrued();
        console2.log("accrued A / MOON", accA, accB);
        uint256 w0 = FEES.balance;
        uint256 totA = IFactory(LF_A).collectPlatformFees(L_A);
        uint256 totB = IFactory(LF_B).collectPlatformFees(MOON_LAUNCH);
        uint256 toVault = (totA * 4000) / 10_000 + (totB * 4000) / 10_000;
        console2.log("collected A / B", totA, totB);
        console2.log("vault received / fees wallet received", address(v).balance, FEES.balance - w0);
        assertEq(address(v).balance, toVault);
        assertEq(v.totalFromFactories(), toVault);
        assertEq(FEES.balance - w0, totA + totB - toVault);
        assertGt(toVault, 0);

        // manual top-up (40% of NFT/staking fees), then record price and buy on the real pool
        vm.deal(FEES, 1 ether);
        vm.prank(FEES);
        v.topUp{value: 0.1 ether}();
        v.observePrice();
        skip(6 minutes);
        uint256 dead0 = IERC20(POLYDASH).balanceOf(DEAD);
        (uint256 e, uint256 b, uint256 k) = v.buy();
        console2.log("buy: eth in", e);
        console2.log("buy: burned", b);
        console2.log("buy: held for stakers", k);
        assertGt(e, 0);
        assertLe(e, 0.02 ether); // thin pool: the 3% price limit can stop the swap early (partial fill)
        assertEq(IERC20(POLYDASH).balanceOf(DEAD) - dead0, b);
        assertEq(IERC20(POLYDASH).balanceOf(address(v)), k);
        v.releaseToTarget();
        assertEq(IERC20(POLYDASH).balanceOf(address(pool)), k);
        assertEq(pool.rewardReserve(), k);
        assertApproxEqAbs(b * 10_000 / (b + k), 6250, 1);
        assertEq(IERC20(WETH).balanceOf(address(v)), 0);

        // whale moves the price between steps: buy is cancelled
        skip(10 minutes);
        v.observePrice();
        Whale wh = new Whale(IPoolManager(PM), v.poolKey());
        vm.deal(address(wh), 10 ether);
        wh.buyPoly(0.5 ether);
        skip(6 minutes);
        uint256 bal = address(v).balance;
        vm.expectRevert(V.PriceMoved.selector);
        v.buy();
        assertEq(address(v).balance, bal);
        console2.log("whale cancel: ok, pending", bal);
    }

    function test_fork_rewards_pool_path() public {
        _config();
        // a staker with real POLYDASH (from the admin wallet's balance on the fork)
        address staker = address(0x5A4E);
        vm.prank(ADMIN);
        IERC20(POLYDASH).transfer(staker, 10_000_000 ether);
        vm.startPrank(staker);
        IERC20(POLYDASH).approve(address(pool), type(uint256).max);
        pool.stake(10_000_000 ether);
        vm.stopPrank();

        vm.deal(FEES, 1 ether);
        vm.prank(FEES);
        v.topUp{value: 0.1 ether}();
        v.observePrice();
        skip(6 minutes);
        uint256 d0 = IERC20(POLYDASH).balanceOf(DEAD);
        (uint256 e, uint256 b, uint256 k) = v.buy();
        console2.log("eth in", e);
        console2.log("burned to dead (62.5%)", b);
        console2.log("to rewards pool (37.5%)", k);
        assertEq(IERC20(POLYDASH).balanceOf(DEAD) - d0, b);
        v.releaseToTarget();
        assertEq(pool.rewardReserve(), k);
        assertEq(pool.periodFinish(), block.timestamp + 30 days);

        skip(15 days);
        uint256 half = pool.earned(staker);
        console2.log("staker earned after 15 days", half);
        assertApproxEqRel(half, k / 2, 0.001e18);
        skip(15 days);
        vm.prank(staker);
        pool.exit();
        uint256 got = IERC20(POLYDASH).balanceOf(staker);
        console2.log("staker balance after full exit", got);
        assertEq(pool.balanceOf(staker), 0);
        assertEq(pool.totalStaked(), 0);
        assertApproxEqRel(got, 10_000_000 ether + k, 0.0001e18);
        assertGe(IERC20(POLYDASH).balanceOf(address(pool)), pool.rewardReserve());

        // the existing V2 POLYDASH pool still cannot be a target (no top-up function); live pools untouched
        assertFalse(v.isValidTarget(POLY_POOL_V2));
        vm.prank(FEES);
        vm.expectRevert(V.InvalidTarget.selector);
        v.proposeTarget(POLY_POOL_V2);
        assertEq(v.rewardsTarget(), address(pool));
        // EOA rejected
        vm.prank(FEES);
        vm.expectRevert(V.InvalidTarget.selector);
        v.proposeTarget(address(0xBEEF));
    }
}
