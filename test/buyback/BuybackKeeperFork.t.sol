// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {PolydashBuybackVault as V} from "../../src/buyback/PolydashBuybackVault.sol";
import {PolydashRewardsPool as RP} from "../../src/buyback/PolydashRewardsPool.sol";

/// Proves the buyback keeper's exact call sequence works against the LIVE
/// deployed contracts on a mainnet fork:
///   fund the vault (as fees / a manual topUp would) -> observePrice()
///   -> warp 6 minutes -> buy() -> releaseToTarget()
///
/// No mainnet transaction is sent; the fork is local only.
///
/// FORK_RPC=https://rpc.mainnet.chain.robinhood.com forge test --match-contract BuybackKeeperFork -vv
contract BuybackKeeperFork is Test {
    address constant VAULT = 0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193;
    address constant REWARDS_POOL = 0x608d106Bb58A804fcd45823e0C6087801dee2aCa;
    address constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address constant KEEPER = address(0xBEEF);

    V v;
    RP pool;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        // Default fork block is pinned (not latest) on purpose: at the latest
        // block the pool has so much accrued fee state that the hook's
        // fee-collection path needs more storage proofs than the free public
        // RPCs will serve in one batch, and the test fails intermittently
        // with FatalExternalError. At block 104500000 (shortly after the
        // vault's deployment at 103888442) the same cycle runs reliably.
        // Override with FORK_BLOCK=<n> to run against any other block.
        uint256 forkBlock = vm.envOr("FORK_BLOCK", uint256(104500000));
        vm.createSelectFork(rpc, forkBlock);
        v = V(payable(VAULT));
        pool = RP(REWARDS_POOL);
        assertGt(address(v).code.length, 0, "vault not deployed on this fork");
        assertGt(address(pool).code.length, 0, "rewards pool not deployed on this fork");
        vm.deal(KEEPER, 1 ether); // keeper pays its own gas

        // NOTE: run this test against https://robinhood.drpc.org (or another
        // provider RPC), NOT the official public RPC
        // https://rpc.mainnet.chain.robinhood.com. The official RPC cannot
        // serve the storage proofs the Uniswap V4 hook's fee-collection path
        // needs during buy() — it aborts with "too_many_data_frames" and the
        // test reverts with FatalExternalError inside the hook. That is an
        // RPC limitation, not a contract failure: the same test passes
        // against dRPC.
    }

    function test_keeper_cycle() public {
        // The vault has never run on mainnet: confirm the fork starts clean.
        assertEq(v.buyCount(), 0, "unexpected prior buys on this fork");
        assertEq(v.totalBurned(), 0, "unexpected prior burns on this fork");
        assertTrue(v.targetActive(), "rewards target should be active");

        // Fund the vault the way launch fees (or a manual topUp) would:
        // 0.005 ETH, exactly the keeper's minimum buy threshold.
        vm.deal(address(v), 0.005 ether);
        assertEq(v.pendingEth(), 0.005 ether);

        // Step 1: observe the price.
        vm.prank(KEEPER);
        v.observePrice();
        assertGt(v.obsTime(), 0, "observation not recorded");

        // Step 2: wait 6 minutes (contract requires 5-60).
        vm.warp(block.timestamp + 360);

        // Step 3: buy. Spends at most maxBuyEth (0.02 ETH); here the whole balance.
        uint256 burnedBefore = v.totalBurned();
        uint256 spentBefore = v.totalEthSpent();
        vm.prank(KEEPER);
        (uint256 ethIn, uint256 burned, uint256 toStakers) = v.buy();
        assertEq(v.buyCount(), 1, "buy did not register");
        assertEq(ethIn, 0.005 ether, "buy should spend the whole vault balance");
        assertGt(burned, 0, "nothing burned");
        assertGt(toStakers, 0, "nothing held for stakers");
        assertEq(v.totalEthSpent(), spentBefore + ethIn);
        assertEq(v.totalBurned(), burnedBefore + burned);
        // 62.5% burned / 37.5% held for stakers (within 0.1% rounding).
        uint256 totalBought = burned + toStakers;
        assertApproxEqRel(burned, (totalBought * 6250) / 10_000, 1e15);
        assertApproxEqRel(toStakers, (totalBought * 3750) / 10_000, 1e15);

        // Step 4: release the stakers' share to the rewards pool.
        uint256 held = v.heldForStakers();
        assertEq(held, toStakers, "held amount mismatch");
        uint256 notifiedBefore = pool.totalNotified();
        vm.prank(KEEPER);
        uint256 released = v.releaseToTarget();
        assertEq(released, held, "release amount mismatch");
        assertEq(v.heldForStakers(), 0, "vault still holds staker POLYDASH");
        assertGt(pool.totalNotified(), notifiedBefore, "rewards pool got nothing");
        assertGt(pool.rewardRate(), 0, "rewards not streaming");
        assertGt(pool.periodFinish(), block.timestamp, "stream already finished");
        console2.log("keeper cycle ok, ethIn", ethIn);
        console2.log("keeper cycle ok, burned", burned);
        console2.log("keeper cycle ok, toStakers", toStakers);
    }
}
