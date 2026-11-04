// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PolypadTokenFloorCollection as C} from "../../src/floorvault/PolypadTokenFloorCollection.sol";
import {FloorVaultBase} from "./FloorVaultBase.sol";
import "./Mocks.sol";

contract FloorVaultHandler is Test {
    C public c;
    MockToken public tok;
    MockLaunch public launch;
    PoolSwapTest public sw;
    PoolKey public key;
    address public creator;
    address[3] public users = [address(0x1001), address(0x1002), address(0x1003)];
    uint256 public t; // tracked time (explicit warps)

    uint256 public ghostFloorIn;
    uint256 public ghostEthOut;
    uint256 public ghostTokOut; // paid + credited owed
    uint256 public ghostTokBought;
    uint256 public ghostCreatorAccrued;
    uint256 public ghostCreatorOut;
    uint256 public ghostProRataViolations;
    uint256 public buys;
    uint256 public burns;

    mapping(address => uint256[]) internal held;

    constructor(C _c, MockToken _tok, MockLaunch _l, PoolSwapTest _sw, PoolKey memory _k, address _creator) {
        c = _c;
        tok = _tok;
        launch = _l;
        sw = _sw;
        key = _k;
        creator = _creator;
        t = block.timestamp;
        for (uint256 i; i < 3; i++) {
            vm.deal(users[i], 1000 ether);
        }
        vm.deal(address(this), 1000 ether);
    }

    receive() external payable {}

    function _adv(uint256 s) internal {
        t += s;
        vm.warp(t);
    }

    function mint(uint256 u, uint256 q) external {
        address a = users[u % 3];
        q = bound(q, 1, 5);
        if (c.totalMinted() + q > c.maxSupply() || c.walletMinted(a) + q > c.maxPerWallet()) return;
        uint256 first = c.totalMinted();
        uint256 cost = c.price() * q;
        uint256 floorCut = cost * c.floorBps() / 10_000;
        vm.prank(a);
        c.mint{value: cost}(q);
        ghostFloorIn += floorCut;
        ghostCreatorAccrued += cost - cost * 20 / 10_000 - floorCut;
        for (uint256 i; i < q; i++) {
            held[a].push(first + i);
        }
    }

    function burn(uint256 u, uint256 n) external {
        address a = users[u % 3];
        uint256 len = held[a].length;
        if (len == 0) return;
        n = bound(n, 1, len);
        uint256[] memory ids = new uint256[](n);
        for (uint256 i; i < n; i++) {
            ids[i] = held[a][len - 1 - i];
        }
        for (uint256 i; i < n; i++) {
            held[a].pop();
        }
        uint256 o = c.outstanding();
        uint256 vEth = c.ethFloor() + c.pendingEth();
        uint256 vTok = c.tokenReserve();
        vm.prank(a);
        (uint256 e, uint256 tk) = c.redeem(ids);
        // pro rata: exactly floor(v * n / o) of each bucket (ETH split in two buckets -> within 1 wei)
        if (tk != vTok * n / o) ghostProRataViolations++;
        if (e + 1 < vEth * n / o || e > vEth * n / o + 1) ghostProRataViolations++;
        ghostEthOut += e;
        ghostTokOut += tk;
        burns++;
    }

    function graduate() external {
        launch.setGraduated(true);
    }

    function buy(uint256 wait) external {
        if (!launch.graduated() || c.pendingEth() == 0) return;
        _adv(11 minutes);
        if (c.obsTime() == 0 || block.timestamp > c.obsTime() + 1 hours) c.observePrice();
        _adv(bound(wait, 5 minutes, 60 minutes));
        try c.buyToken() returns (uint256, uint256 out) {
            ghostTokBought += out;
            buys++;
        } catch {}
    }

    function marketMove(uint256 amt, bool up) external {
        if (!launch.graduated()) return;
        amt = bound(amt, 0.01 ether, 20 ether);
        if (up) {
            sw.swap{value: amt}(
                key,
                IPoolManager.SwapParams(true, -int256(amt), TickMath.MIN_SQRT_PRICE + 1),
                PoolSwapTest.TestSettings(false, false),
                ""
            );
        } else {
            uint256 ti = amt * 1000;
            if (tok.balanceOf(address(this)) < ti) return;
            sw.swap(
                key,
                IPoolManager.SwapParams(false, -int256(ti), TickMath.MAX_SQRT_PRICE - 1),
                PoolSwapTest.TestSettings(false, false),
                ""
            );
        }
    }

    function creatorTriesEverything() external {
        uint256 b = c.creatorBalance();
        vm.startPrank(creator);
        try c.withdrawCreator() {
            ghostCreatorOut += b;
        } catch {}
        try c.endTokenShare() {} catch {}
        uint256[] memory ids = new uint256[](1);
        try c.redeem(ids) {
            revert("creator redeemed");
        } catch {}
        vm.stopPrank();
    }

    function platform() external {
        try c.withdrawPlatform() {} catch {}
    }

    function wait(uint256 s) external {
        _adv(bound(s, 1, 30 days));
    }

    function endShare() external {
        try c.endTokenShare() {} catch {}
    }
}

contract TokenFloorInvariant is FloorVaultBase {
    FloorVaultHandler h;
    C c;

    function setUp() public override {
        super.setUp();
        c = _create();
        h = new FloorVaultHandler(c, tok, launch, sw, key, creator);
        tok.mint(address(h), 1e27);
        vm.prank(address(h));
        tok.approve(address(sw), type(uint256).max);
        targetContract(address(h));
    }

    function invariant_ethAccounting_exact() public view {
        assertEq(address(c).balance, c.ethFloor() + c.pendingEth() + c.creatorBalance() + c.platformBalance());
    }

    function invariant_payoutsNeverExceedDeposits() public view {
        // ETH out to burners + ETH swapped + ETH still in vault == ETH deposited to the vault
        assertEq(h.ghostEthOut() + c.totalEthSwapped() + c.ethFloor() + c.pendingEth(), h.ghostFloorIn());
        assertLe(h.ghostEthOut(), h.ghostFloorIn());
        assertLe(h.ghostTokOut(), c.totalTokensBought());
    }

    function invariant_tokenAccounting() public view {
        assertEq(c.totalTokensBought(), h.ghostTokBought());
        assertEq(h.ghostTokOut() + c.tokenReserve(), c.totalTokensBought());
        assertGe(tok.balanceOf(address(c)), c.tokenReserve());
    }

    function invariant_proRata() public view {
        assertEq(h.ghostProRataViolations(), 0);
    }

    function invariant_creatorOnlyGetsProceeds() public view {
        assertLe(h.ghostCreatorOut(), h.ghostCreatorAccrued());
        assertEq(h.ghostCreatorOut() + c.creatorBalance(), h.ghostCreatorAccrued());
    }

    function invariant_supply() public view {
        assertEq(c.outstanding(), c.totalMinted() - c.totalRedeemed());
        assertLe(c.totalMinted(), c.maxSupply());
    }

    function invariant_noQueueAfterEnd() public view {
        if (!c.tokenShareActive()) assertEq(c.pendingEth(), 0);
    }

    /// Deterministic mixed sequence through the same handler: proves the handler path really buys and burns.
    function test_handler_mixedSequence_buysAndBurns() public {
        for (uint256 i; i < 6; i++) {
            h.mint(i, 5);
        }
        h.burn(0, 2);
        h.graduate();
        h.buy(10 minutes);
        h.mint(1, 3);
        h.marketMove(1 ether, true);
        h.buy(30 minutes);
        h.burn(1, 3);
        h.marketMove(1 ether, false);
        h.buy(5 minutes);
        h.burn(2, 5);
        h.creatorTriesEverything();
        assertGt(h.buys(), 0);
        assertGt(h.burns(), 2);
        assertEq(h.ghostProRataViolations(), 0);
        invariant_payoutsNeverExceedDeposits();
        invariant_tokenAccounting();
        invariant_ethAccounting_exact();
    }
}
