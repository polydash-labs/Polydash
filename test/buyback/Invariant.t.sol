// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./BuybackBase.sol";

contract BuybackHandler is Test {
    V v;
    MockLaunchFactory fa;
    MockRewardsPool rp;
    address admin;
    MockToken tok;
    uint256 public ghostIn;

    constructor(V _v, MockLaunchFactory _fa, MockRewardsPool _rp, address _admin, MockToken _tok) {
        v = _v;
        fa = _fa;
        rp = _rp;
        admin = _admin;
        tok = _tok;
    }

    function fund(uint96 a) external {
        a = uint96(bound(a, 0, 5 ether));
        vm.deal(address(this), a);
        fa.send{value: a}(address(v), a);
        ghostIn += a;
    }

    function top(uint96 a) external {
        a = uint96(bound(a, 0, 5 ether));
        vm.deal(address(this), a);
        v.topUp{value: a}();
        ghostIn += a;
    }

    function observe() external {
        try v.observePrice() {} catch {}
    }

    function buy() external {
        try v.buy() {} catch {}
    }

    function warp(uint32 s) external {
        skip(bound(s, 1, 2 days));
    }

    function propose(bool none) external {
        vm.prank(admin);
        try v.proposeTarget(none ? address(0) : address(rp)) {} catch {}
    }

    function execute() external {
        vm.prank(admin);
        try v.executeTarget() {} catch {}
    }

    function release() external {
        try v.releaseToTarget() {} catch {}
    }

    function burnHeld() external {
        try v.burnHeldStaking() {} catch {}
    }
}

contract VaultInvariant is BuybackBase {
    BuybackHandler h;

    function setUp() public override {
        super.setUp();
        h = new BuybackHandler(v, fa, rp, feesWallet, tok);
        targetContract(address(h));
    }

    function invariant_eth_conserved() public view {
        assertEq(address(v).balance + v.totalEthSpent(), h.ghostIn());
    }

    function invariant_tokens_accounted() public view {
        assertEq(tok.balanceOf(address(v)), v.totalToStakers() - v.totalReleased() - v.totalStakingBurned());
        assertEq(tok.balanceOf(address(rp)), v.totalReleased());
    }

    function invariant_burn_tracked() public view {
        assertEq(tok.balanceOf(DEAD), v.totalBurned() + v.totalStakingBurned());
    }

    function invariant_no_weth_left() public view {
        assertEq(weth.balanceOf(address(v)), 0);
    }

    function invariant_target_valid_or_none() public view {
        address t = v.rewardsTarget();
        assertTrue(t == address(0) || t == address(rp));
    }
}
