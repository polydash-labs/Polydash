// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TreasuryRulesFactory} from "../../src/treasury/TreasuryRulesFactory.sol";
import {TreasuryRules} from "../../src/treasury/TreasuryRules.sol";
import {TPoolKey, TSwapParams, TFees, ITUnlockCallback} from "../../src/treasury/ITreasuryExternal.sol";
import {PolydashStakingFactoryV2} from "../../src/v2/PolydashStakingFactoryV2.sol";
import {PolydashStakingPoolV2} from "../../src/v2/PolydashStakingPoolV2.sol";
import {MockERC20} from "../mocks/CreatorMocks.sol";

contract TLaunch {
    address public creator;
    address public token;
    address public hook = address(0x400C);
    bool public graduated;
    uint256 public rate = 1000; // tokens per ETH (before 1% fee)
    uint256 public refundBps; // simulate graduation refund

    constructor(address c, address t) {
        creator = c;
        token = t;
    }

    function setGraduated(bool g) external {
        graduated = g;
    }

    function setRate(uint256 r) external {
        rate = r;
    }

    function setRefund(uint256 b) external {
        refundBps = b;
    }

    function quoteBuy(uint256 e) public view returns (uint256 out, TFees memory f) {
        out = e * rate * 99 / 100;
        f.total = e / 100;
    }

    function buy(uint256 minOut) external payable returns (uint256 out) {
        uint256 used = msg.value - msg.value * refundBps / 10_000;
        (out,) = quoteBuy(used);
        require(out >= minOut, "Slippage");
        MockERC20(token).mint(msg.sender, out);
        if (used < msg.value) {
            (bool ok,) = msg.sender.call{value: msg.value - used}("");
            require(ok);
        }
    }
}

contract TLF {
    mapping(address => address) public launchOfToken;

    function set(address t, address l) external {
        launchOfToken[t] = l;
    }
}

/// Minimal V4 PoolManager mock: fixed spot price, swap pays out at (spot * (1 - impactBps)).
contract TPM {
    uint160 public sqrtP;
    uint256 public impactBps;
    address public tok;
    uint256 public owed;
    bytes32 public lastSlot;

    constructor(address t) {
        tok = t;
    }

    function set(uint160 s, uint256 i) external {
        sqrtP = s;
        impactBps = i;
    }

    function extsload(bytes32) external view returns (bytes32) {
        return bytes32(uint256(sqrtP));
    }

    function unlock(bytes calldata d) external returns (bytes memory r) {
        r = ITUnlockCallback(msg.sender).unlockCallback(d);
        require(owed == 0, "unsettled");
    }

    function swap(TPoolKey memory k, TSwapParams memory p, bytes calldata) external returns (int256) {
        require(k.currency0 == address(0) && k.currency1 == tok && k.tickSpacing == 200 && p.zeroForOne, "key");
        uint256 inA = uint256(-p.amountSpecified);
        uint256 out = inA * uint256(sqrtP) / (1 << 96) * uint256(sqrtP) / (1 << 96) * (10_000 - impactBps) / 10_000;
        owed = inA;
        int128 a0 = -int128(int256(inA));
        int128 a1 = int128(int256(out));
        return (int256(a0) << 128) | int256(uint256(uint128(a1)));
    }

    function settle() external payable returns (uint256) {
        owed -= msg.value;
        return msg.value;
    }

    function take(address c, address to, uint256 a) external {
        MockERC20(c).mint(to, a);
    }
}

contract TreasuryRulesTest is Test {
    TreasuryRulesFactory f;
    TLF lfA;
    TLF lfB;
    TLaunch L;
    MockERC20 tok;
    TPM pm;
    PolydashStakingFactoryV2 sf;
    address creator = address(0xC0);
    address agent = address(0xA9);
    address rando = address(0xBAD);
    uint256 creatorPk = 0xC0FFEE;
    address creatorSigner;

    function _r() internal pure returns (TreasuryRules.Rules memory r) {
        r.maxEthPerDay = 1 ether;
        r.maxEthPerBuyback = 0.25 ether;
        r.minInterval = 1 hours;
        r.maxSlippageBps = 300;
        r.burnBought = true;
        r.maxAirdropPerRound = 1000e18;
        r.maxPoolReward = 500e18;
        r.poolMinInterval = 7 days;
        r.poolDuration = 30 days;
        r.poolClaimFeeBps = 100;
    }

    function setUp() public {
        vm.warp(10 days);
        creatorSigner = vm.addr(creatorPk);
        tok = new MockERC20("TOK");
        L = new TLaunch(creator, address(tok));
        lfA = new TLF();
        lfB = new TLF();
        lfA.set(address(tok), address(L));
        pm = new TPM(address(tok)); // ~1000 tok/ETH
        pm.set(uint160(uint256(31.6227766e18) * (1 << 96) / 1e18), 100);
        sf = new PolydashStakingFactoryV2(address(0xFEE));
        f = new TreasuryRulesFactory(address(lfA), address(lfB), address(sf), address(pm));
        vm.deal(creator, 100 ether);
        vm.deal(agent, 1 ether);
    }

    function _vault(address own) internal returns (TreasuryRules v) {
        address[] memory ex = new address[](1);
        ex[0] = agent;
        vm.prank(own);
        v = TreasuryRules(payable(f.createRules{value: 5 ether}(address(tok), _r(), ex, 0)));
    }

    function _mk() internal returns (TreasuryRules) {
        return _vault(creator);
    }

    // ---------------- factory
    function test_onlyCreator() public {
        address[] memory ex;
        vm.prank(rando);
        vm.expectRevert(TreasuryRulesFactory.NotTokenCreator.selector);
        f.createRules(address(tok), _r(), ex, 0);
        MockERC20 other = new MockERC20("X");
        vm.prank(creator);
        vm.expectRevert(TreasuryRulesFactory.NotPolydashToken.selector);
        f.createRules(address(other), _r(), ex, 0);
    }

    function test_factoryB_and_onePerToken() public {
        MockERC20 t2 = new MockERC20("B");
        TLaunch l2 = new TLaunch(creator, address(t2));
        lfB.set(address(t2), address(l2));
        address[] memory ex;
        vm.prank(creator);
        address v = f.createRules(address(t2), _r(), ex, 0);
        assertEq(f.rulesOf(address(t2)), v);
        assertTrue(f.isRules(v));
        assertEq(f.rulesCount(), 1);
        vm.prank(creator);
        vm.expectRevert(TreasuryRulesFactory.AlreadyExists.selector);
        f.createRules(address(t2), _r(), ex, 0);
    }

    function test_launchTokenMismatch() public {
        MockERC20 t3 = new MockERC20("C"); // launch.token() != t3
        lfA.set(address(t3), address(L));
        address[] memory ex;
        vm.prank(creator);
        vm.expectRevert(TreasuryRulesFactory.NotPolydashToken.selector);
        f.createRules(address(t3), _r(), ex, 0);
    }

    function test_initState() public {
        TreasuryRules v = _mk();
        assertEq(v.owner(), creator);
        assertEq(address(v).balance, 5 ether);
        assertEq(v.timelockDelay(), 48 hours);
        assertTrue(v.isExecutor(agent));
        assertEq(v.executors().length, 1);
        assertEq(f.rulesByCreator(creator)[0], address(v));
        assertEq(v.factory(), address(f));
        address[] memory ex;
        TreasuryRules.Rules memory r;
        vm.expectRevert(TreasuryRules.AlreadyInitialized.selector);
        v.initialize(rando, address(tok), address(L), address(sf), address(pm), r, ex, 0);
    }

    function test_badDelayAndRules() public {
        address[] memory ex;
        TreasuryRules.Rules memory r = _r();
        vm.prank(creator);
        vm.expectRevert(TreasuryRules.InvalidParam.selector);
        f.createRules(address(tok), r, ex, 1 hours);
        r.maxEthPerBuyback = 2 ether;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRules.InvalidRules.selector, "maxEthPerBuyback"));
        f.createRules(address(tok), r, ex, 0);
        r = _r();
        r.maxSlippageBps = 5000;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRules.InvalidRules.selector, "maxSlippageBps"));
        f.createRules(address(tok), r, ex, 0);
        r = _r();
        r.poolClaimFeeBps = 50;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRules.InvalidRules.selector, "poolClaimFeeBps"));
        f.createRules(address(tok), r, ex, 0);
    }

    // ---------------- buyback (curve)
    function test_buybackCurveBurns() public {
        TreasuryRules v = _mk();
        vm.prank(agent);
        uint256 out = v.buyback(0.25 ether, 0);
        assertEq(out, 247.5e18);
        assertEq(tok.balanceOf(v.DEAD()), out);
        assertEq(tok.balanceOf(address(v)), 0);
        assertEq(v.spentToday(), 0.25 ether);
        assertEq(v.totalTokensBurned(), out);
        assertEq(agent.balance, 1 ether);
        assertEq(v.remainingToday(), 0.75 ether);
    }

    function test_buybackLimits() public {
        TreasuryRules v = _mk();
        vm.prank(rando);
        vm.expectRevert(TreasuryRules.NotExecutor.selector);
        v.buyback(0.1 ether, 0);
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.PerCallCap.selector);
        v.buyback(0.3 ether, 0);
        vm.prank(agent);
        v.buyback(0.25 ether, 0);
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.Interval.selector);
        v.buyback(0.25 ether, 0);
        for (uint256 i; i < 3; ++i) {
            skip(1 hours);
            vm.prank(agent);
            v.buyback(0.25 ether, 0);
        }
        skip(1 hours);
        if (block.timestamp / 1 days == v.currentDay()) {
            vm.prank(agent);
            vm.expectRevert(TreasuryRules.DailyCap.selector);
            v.buyback(0.01 ether, 0);
        }
        vm.warp((block.timestamp / 1 days + 1) * 1 days);
        vm.prank(agent);
        v.buyback(0.25 ether, 0);
        assertEq(v.spentToday(), 0.25 ether);
    }

    function test_buybackExecutorMinOut() public {
        TreasuryRules v = _mk();
        vm.prank(agent);
        vm.expectRevert();
        v.buyback(0.1 ether, 1000e18);
    }

    function test_priceFloor() public {
        TreasuryRules v = _mk();
        TreasuryRules.Rules memory r = _r();
        r.minTokensPerEth = 2000e18;
        vm.prank(creator);
        uint256 id = v.queueRules(r);
        skip(48 hours);
        v.execute(id);
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.PriceFloor.selector);
        v.buyback(0.1 ether, 0);
        L.setRate(3000);
        vm.prank(agent);
        v.buyback(0.1 ether, 0);
    }

    function test_curveRefundCountsActualSpend() public {
        TreasuryRules v = _mk();
        L.setRefund(4000);
        vm.prank(agent);
        uint256 out = v.buyback(0.25 ether, 0);
        assertEq(v.spentToday(), 0.15 ether);
        assertEq(out, 148.5e18);
        assertEq(address(v).balance, 4.85 ether);
    }

    function test_keepBoughtTokens() public {
        TreasuryRules v = _mk();
        TreasuryRules.Rules memory r = _r();
        r.burnBought = false;
        vm.prank(creator);
        uint256 id = v.queueRules(r);
        skip(48 hours);
        v.execute(id);
        vm.prank(agent);
        uint256 out = v.buyback(0.2 ether, 0);
        assertEq(tok.balanceOf(address(v)), out);
        assertEq(v.availableTokens(), out);
    }

    function test_openExecution() public {
        TreasuryRules v = _mk();
        TreasuryRules.Rules memory r = _r();
        r.openExecution = true;
        vm.prank(creator);
        uint256 id = v.queueRules(r);
        skip(48 hours);
        v.execute(id);
        uint256 b = rando.balance;
        vm.prank(rando);
        v.buyback(0.1 ether, 0);
        assertEq(rando.balance, b);
    }

    // ---------------- buyback (V4 pool)
    function test_buybackPool() public {
        TreasuryRules v = _mk();
        L.setGraduated(true);
        vm.prank(agent);
        uint256 out = v.buyback(0.2 ether, 0);
        assertApproxEqRel(out, 198e18, 0.001e18);
        assertEq(tok.balanceOf(v.DEAD()), out);
        assertEq(address(v).balance, 4.8 ether);
    }

    function test_poolSandwichBlockedBySlippage() public {
        TreasuryRules v = _mk(); // 5% worse than spot
        L.setGraduated(true);
        pm.set(pm.sqrtP(), 500);
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.Slippage.selector);
        v.buyback(0.2 ether, 0);
    }

    function test_unlockCallbackOnlyPM() public {
        TreasuryRules v = _mk();
        vm.expectRevert(TreasuryRules.NotPoolManager.selector);
        v.unlockCallback(abi.encode(uint256(1)));
    }

    // ---------------- pause
    function test_pause() public {
        TreasuryRules v = _mk();
        vm.prank(rando);
        vm.expectRevert(TreasuryRules.NotOwner.selector);
        v.setPaused(true);
        vm.prank(creator);
        v.setPaused(true);
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.IsPaused.selector);
        v.buyback(0.1 ether, 0);
        vm.prank(creator);
        v.setPaused(false);
        vm.prank(agent);
        v.buyback(0.1 ether, 0);
    }

    // ---------------- timelock
    function test_withdrawTimelock() public {
        TreasuryRules v = _mk();
        vm.prank(rando);
        vm.expectRevert(TreasuryRules.NotOwner.selector);
        v.queueWithdraw(address(0), 1 ether, rando);
        vm.prank(creator);
        uint256 id = v.queueWithdraw(address(0), 2 ether, creator);
        TreasuryRules.Change memory c = v.getChange(id);
        assertEq(c.eta, block.timestamp + 48 hours);
        vm.expectRevert(TreasuryRules.TooEarly.selector);
        v.execute(id);
        skip(48 hours);
        uint256 b = creator.balance;
        vm.prank(rando);
        v.execute(id);
        assertEq(creator.balance, b + 2 ether);
        vm.expectRevert(TreasuryRules.AlreadyDone.selector);
        v.execute(id);
    }

    function test_cancel() public {
        TreasuryRules v = _mk();
        vm.prank(creator);
        uint256 id = v.queueWithdraw(address(0), 2 ether, creator);
        vm.prank(rando);
        vm.expectRevert(TreasuryRules.NotOwner.selector);
        v.cancel(id);
        vm.prank(creator);
        v.cancel(id);
        skip(3 days);
        vm.expectRevert(TreasuryRules.AlreadyDone.selector);
        v.execute(id);
    }

    function test_withdrawTokensRespectsReserve() public {
        TreasuryRules v = _mk();
        tok.mint(address(v), 1000e18);
        _airdrop(v, bytes32(uint256(1)), 800e18);
        vm.prank(creator);
        uint256 id = v.queueWithdraw(address(tok), 500e18, creator);
        skip(48 hours);
        vm.expectRevert(TreasuryRules.Insufficient.selector);
        v.execute(id);
        vm.prank(creator);
        id = v.queueWithdraw(address(tok), 200e18, creator);
        skip(48 hours);
        v.execute(id);
        assertEq(tok.balanceOf(creator), 200e18);
    }

    function test_rulesChangeDelayed() public {
        TreasuryRules v = _mk();
        TreasuryRules.Rules memory r = _r();
        r.maxEthPerDay = 10 ether;
        r.maxEthPerBuyback = 5 ether;
        vm.prank(creator);
        uint256 id = v.queueRules(r);
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.PerCallCap.selector);
        v.buyback(1 ether, 0);
        skip(48 hours);
        v.execute(id);
        vm.prank(agent);
        v.buyback(1 ether, 0);
    }

    function test_executorAddTimelockedRemoveInstant() public {
        TreasuryRules v = _mk();
        address a2 = address(0xA2);
        vm.prank(creator);
        uint256 id = v.queueAddExecutor(a2);
        assertFalse(v.isExecutor(a2));
        skip(48 hours);
        v.execute(id);
        assertTrue(v.isExecutor(a2));
        vm.prank(creator);
        v.removeExecutor(a2);
        assertFalse(v.isExecutor(a2));
        assertEq(v.executors().length, 1);
        vm.prank(a2);
        vm.expectRevert(TreasuryRules.NotExecutor.selector);
        v.buyback(0.1 ether, 0);
    }

    function test_delayChange() public {
        TreasuryRules v = _mk();
        vm.prank(creator);
        vm.expectRevert(TreasuryRules.InvalidParam.selector);
        v.queueDelay(1 hours);
        vm.prank(creator);
        uint256 id = v.queueDelay(7 days);
        skip(48 hours);
        v.execute(id);
        assertEq(v.timelockDelay(), 7 days);
        vm.prank(creator);
        id = v.queueWithdraw(address(0), 1 ether, creator);
        skip(6 days);
        vm.expectRevert(TreasuryRules.TooEarly.selector);
        v.execute(id);
    }

    function test_depositsEmit() public {
        TreasuryRules v = _mk();
        vm.prank(rando);
        vm.deal(rando, 1 ether);
        (bool ok,) = address(v).call{value: 1 ether}("");
        assertTrue(ok);
        tok.mint(rando, 10e18);
        vm.startPrank(rando);
        tok.approve(address(v), 10e18);
        v.depositToken(10e18);
        vm.stopPrank();
        assertEq(tok.balanceOf(address(v)), 10e18);
        assertEq(address(v).balance, 6 ether);
    }

    // ---------------- airdrop
    function _leaf(address a, uint256 amt) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, amt))));
    }

    function _airdrop(TreasuryRules v, bytes32 root, uint256 total) internal returns (uint256 round) {
        vm.prank(creator);
        uint256 id = v.queueAirdrop(root, total, 7 days);
        skip(48 hours);
        v.execute(id);
        round = v.roundsCount() - 1;
    }

    function test_airdropClaims() public {
        TreasuryRules v = _mk();
        tok.mint(address(v), 1000e18);
        address h1 = address(0x111);
        address h2 = address(0x222);
        bytes32 l1 = _leaf(h1, 300e18);
        bytes32 l2 = _leaf(h2, 200e18);
        bytes32 root = l1 < l2 ? keccak256(abi.encode(l1, l2)) : keccak256(abi.encode(l2, l1));
        uint256 rd = _airdrop(v, root, 500e18);
        assertEq(v.reservedTokens(), 500e18);
        assertEq(v.availableTokens(), 500e18);
        bytes32[] memory p = new bytes32[](1);
        p[0] = l2;
        vm.prank(rando);
        v.claim(rd, h1, 300e18, p);
        assertEq(tok.balanceOf(h1), 300e18);
        vm.expectRevert(TreasuryRules.AlreadyClaimed.selector);
        v.claim(rd, h1, 300e18, p);
        vm.expectRevert(TreasuryRules.BadProof.selector);
        v.claim(rd, h2, 999e18, p);
        vm.expectRevert(TreasuryRules.RoundOpen.selector);
        v.closeRound(rd);
        skip(8 days);
        p[0] = l1;
        vm.expectRevert(TreasuryRules.RoundEnded.selector);
        v.claim(rd, h2, 200e18, p);
        v.closeRound(rd);
        assertEq(v.reservedTokens(), 0);
        assertEq(v.availableTokens(), 700e18);
    }

    function test_airdropCaps() public {
        TreasuryRules v = _mk();
        tok.mint(address(v), 5000e18);
        vm.prank(creator);
        uint256 id = v.queueAirdrop(bytes32(uint256(1)), 2000e18, 7 days);
        skip(48 hours);
        vm.expectRevert(TreasuryRules.PerCallCap.selector);
        v.execute(id);
        vm.prank(creator);
        vm.expectRevert(TreasuryRules.InvalidParam.selector);
        v.queueAirdrop(bytes32(uint256(1)), 1, 1 hours);
    }

    function test_airdropWithCreatorSig() public {
        // vault owned by a key we can sign with
        lfA.set(address(tok), address(new TLaunch(creatorSigner, address(tok))));
        vm.deal(creatorSigner, 10 ether);
        TreasuryRules v = _vault(creatorSigner);
        tok.mint(address(v), 1000e18);
        bytes32 root = bytes32(uint256(7));
        uint256 dl = block.timestamp + 1 hours;
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(creatorPk, v.airdropDigest(root, 100e18, 7 days, 0, dl));
        vm.prank(agent);
        v.queueAirdropWithSig(root, 100e18, 7 days, dl, abi.encodePacked(r, s, vv));
        assertEq(v.airdropNonce(), 1);
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.BadSignature.selector);
        v.queueAirdropWithSig(root, 100e18, 7 days, dl, abi.encodePacked(r, s, vv));
        (vv, r, s) = vm.sign(0xBEEF, v.airdropDigest(root, 100e18, 7 days, 1, dl));
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.BadSignature.selector);
        v.queueAirdropWithSig(root, 100e18, 7 days, dl, abi.encodePacked(r, s, vv));
        skip(48 hours);
        v.execute(0);
        assertEq(v.reservedTokens(), 100e18);
    }

    // ---------------- reward pools (follow-on, since V2 pools cannot be topped up)
    function test_createRewardPool() public {
        TreasuryRules v = _mk();
        tok.mint(address(v), 2000e18);
        vm.prank(rando);
        vm.expectRevert(TreasuryRules.NotExecutor.selector);
        v.createRewardPool(100e18);
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.PerCallCap.selector);
        v.createRewardPool(600e18);
        vm.prank(agent);
        address pool = v.createRewardPool(500e18);
        PolydashStakingPoolV2 P = PolydashStakingPoolV2(pool);
        assertEq(P.creator(), address(v));
        assertEq(P.totalRewards(), 500e18);
        assertEq(v.pools()[0], pool);
        assertEq(tok.balanceOf(address(v)), 1500e18);
        assertEq(tok.allowance(address(v), address(sf)), 0);
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.Interval.selector);
        v.createRewardPool(100e18);
        skip(7 days);
        vm.prank(agent);
        v.createRewardPool(100e18);
        assertEq(v.pools().length, 2);
        // holder stakes, claims; creator fee comes back to the vault
        address h = address(0x5555);
        tok.mint(h, 100e18);
        vm.startPrank(h);
        tok.approve(pool, 100e18);
        P.stake(100e18);
        vm.stopPrank();
        skip(31 days);
        vm.prank(h);
        P.claim();
        uint256 b = tok.balanceOf(address(v));
        v.collectFromPool(pool, false);
        assertGt(tok.balanceOf(address(v)), b);
        vm.expectRevert(TreasuryRules.InvalidParam.selector);
        v.collectFromPool(address(0x1234), false);
    }

    function test_rewardPoolRespectsReserve() public {
        TreasuryRules v = _mk();
        tok.mint(address(v), 600e18);
        _airdrop(v, bytes32(uint256(1)), 500e18);
        vm.prank(agent);
        vm.expectRevert(TreasuryRules.Insufficient.selector);
        v.createRewardPool(200e18);
    }

    // ---------------- fuzz: executor can never move ETH anywhere except the swap venue
    function testFuzz_executorNeverPaid(uint96 amt, uint8 n) public {
        TreasuryRules v = _mk();
        uint256 a = bound(amt, 1e12, 0.25 ether);
        uint256 k = bound(n, 1, 6);
        uint256 spent;
        for (uint256 i; i < k; ++i) {
            if (spent + a > 1 ether) break;
            vm.prank(agent);
            v.buyback(a, 0);
            spent += a;
            skip(1 hours);
            if (block.timestamp / 1 days != v.currentDay()) break;
        }
        assertEq(agent.balance, 1 ether);
        assertEq(tok.balanceOf(agent), 0);
        assertLe(v.totalEthSpent(), 1 ether);
    }
}

contract TreasuryRulesInitTest is Test {
    function test_implLockedAndCloneOnce() public {
        TreasuryRulesFactory f = new TreasuryRulesFactory(address(1), address(0), address(2), address(3));
        TreasuryRules impl = TreasuryRules(payable(f.implementation()));
        TreasuryRules.Rules memory r;
        address[] memory ex;
        vm.expectRevert(TreasuryRules.AlreadyInitialized.selector);
        impl.initialize(address(this), address(4), address(5), address(2), address(3), r, ex, 0);
    }
}
