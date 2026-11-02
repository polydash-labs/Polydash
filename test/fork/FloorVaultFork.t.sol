// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PolypadTokenFloorFactory} from "../../src/floorvault/PolypadTokenFloorFactory.sol";
import {PolypadTokenFloorCollection as C} from "../../src/floorvault/PolypadTokenFloorCollection.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IHookInfo} from "../../src/floorvault/Interfaces.sol";

interface ICurve {
    function buy(uint256 minOut) external payable returns (uint256);
    function graduated() external view returns (bool);
    function graduationThreshold() external view returns (uint256);
    function phase() external view returns (uint8);
    function creator() external view returns (address);
}

/// FORK_RPC=https://rpc.mainnet.chain.robinhood.com forge test --match-contract Fork -vv
contract ForkTokenFloor is Test {
    address constant LF_A = 0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2;
    address constant LF_B = 0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2;
    address constant NFT_FACTORY = 0x297c232F2EBCbB4e3Cd0b97167a971fF795EDdDd;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant MOON = 0x196784337bE954268c7d793D20b4b572a4126049;
    address constant MOON_LAUNCH = 0xB023689Bc81A4A54026441842346Cc29C3f10527;
    address constant POLYCAT = 0xf6E8D1902d42A7bB4432E9Bc28F88Bb87C1E1A79;
    address constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address constant ADMIN = 0x89df38Df79C0a7E96214c596ceF5773d2ac353F1;

    PolypadTokenFloorFactory f;
    address creator;
    address alice = address(0xA11CE);
    address whale = address(0x3A1E);

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        // Deployed factory (Sourcify verified); its implementation is 0xFa23E496f7244d1674fA8bE5C42556bd054140EA.
        f = PolypadTokenFloorFactory(0xdD149A1a76363BaAaFEF97c3E8d8cfdD2E7A277c);
        assertEq(f.implementation(), 0xFa23E496f7244d1674fA8bE5C42556bd054140EA);
        creator = ICurve(MOON_LAUNCH).creator();
        vm.deal(alice, 100 ether);
        vm.deal(whale, 10_000 ether);
        vm.deal(creator, 10 ether);
    }

    function _hook() internal view returns (address h) {
        (bool ok, bytes memory r) = MOON_LAUNCH.staticcall(abi.encodeWithSignature("hook()"));
        require(ok);
        h = abi.decode(r, (address));
    }

    function _p(address token) internal pure returns (PolypadTokenFloorFactory.Params memory) {
        return PolypadTokenFloorFactory.Params({
            name: "Moon Floor",
            symbol: "MFL",
            imageUri: "",
            description: "fork sim",
            baseURI: "ipfs://x/",
            maxSupply: 100,
            price: 0.01 ether,
            floorBps: 5000,
            tokenShareBps: 5000,
            maxSlippageBps: 300,
            maxBuyEth: 0.05 ether,
            royaltyBps: 500,
            maxPerWallet: 50,
            startTime: 0,
            token: token,
            payoutWallet: address(0)
        });
    }

    address constant POLYCAT_LAUNCH = 0x25D1049133e4647672880F513Ad1aeBCC4E150A8;
    address constant HOOK_OLD = 0x04990E6671C98e1B43034E52366Af11396d960CC;
    address constant HOOK_CURRENT = 0x4d3066bBfF889023def912D2fDe36c44357fA0cC;

    /// Factory A (current) launch on the current hook: POLYCAT.
    function test_fork_fullFlow_POLYCAT_factoryA_currentHook() public {
        address pc = ICurve(POLYCAT_LAUNCH).creator();
        vm.deal(pc, 10 ether);
        assertEq(f.launchOf(POLYCAT), POLYCAT_LAUNCH);
        (bool ok, bytes memory r) = POLYCAT_LAUNCH.staticcall(abi.encodeWithSignature("hook()"));
        assertTrue(ok);
        assertEq(abi.decode(r, (address)), HOOK_CURRENT);
        vm.prank(pc);
        C c = C(payable(f.createCollection(_p(POLYCAT))));
        vm.prank(alice);
        c.mint{value: 0.2 ether}(20);
        vm.expectRevert(C.NotGraduated.selector);
        c.observePrice();
        vm.prank(whale);
        ICurve(POLYCAT_LAUNCH).buy{value: 5000 ether}(0);
        assertTrue(ICurve(POLYCAT_LAUNCH).graduated());
        console2.log("POLYCAT hook buy fee bps", c.buyFeeBps());
        assertLe(c.buyFeeBps(), 520);
        c.observePrice();
        skip(5 minutes);
        (uint256 ethIn, uint256 out) = c.buyToken();
        console2.log("POLYCAT ethIn", ethIn);
        console2.log("POLYCAT tokensOut", out);
        assertGt(out, 0);
        uint256[] memory ids = new uint256[](20);
        for (uint256 i; i < 20; i++) {
            ids[i] = i;
        }
        vm.prank(alice);
        (uint256 e, uint256 t) = c.redeem(ids);
        assertEq(t, out);
        assertEq(e, 0.1 ether - ethIn);
        assertEq(IERC20(POLYCAT).balanceOf(alice), out);
        console2.log("POLYCAT full burn ETH", e);
        console2.log("POLYCAT full burn tokens", t);
    }

    /// 180-day ETH-only switch on a real launch that is not graduated on mainnet.
    function test_fork_endTokenShare_realLaunch() public {
        vm.prank(creator);
        C c = C(payable(f.createCollection(_p(MOON))));
        vm.prank(alice);
        c.mint{value: 0.1 ether}(10);
        skip(180 days);
        if (!ICurve(MOON_LAUNCH).graduated()) {
            c.endTokenShare();
            assertEq(c.ethFloor(), 0.05 ether);
            assertEq(c.pendingEth(), 0);
        }
    }

    function test_fork_fullFlow_MOON() public {
        console2.log("factory runtime bytes", address(f).code.length);
        console2.log("impl runtime bytes", f.implementation().code.length);
        console2.log("launchOf(MOON)", f.launchOf(MOON));
        assertEq(f.launchOf(MOON), MOON_LAUNCH);
        assertEq(f.launchOf(POLYDASH), address(0)); // not a Polypad launch token

        vm.prank(alice);
        vm.expectRevert(PolypadTokenFloorFactory.NotCreator.selector);
        f.createCollection(_p(MOON));
        vm.prank(creator);
        vm.expectRevert(PolypadTokenFloorFactory.NotCreator.selector);
        f.createCollection(_p(POLYCAT)); // MOON creator cannot link POLYCAT
        vm.prank(creator);
        vm.expectRevert(PolypadTokenFloorFactory.NotLaunchToken.selector);
        f.createCollection(_p(POLYDASH));

        uint256 g = gasleft();
        vm.prank(creator);
        C c = C(payable(f.createCollection(_p(MOON))));
        console2.log("create gas", g - gasleft());

        g = gasleft();
        vm.prank(alice);
        c.mint{value: 0.2 ether}(20);
        console2.log("mint 20 gas", g - gasleft());
        assertEq(c.pendingEth(), 0.05 ether);
        assertEq(c.ethFloor(), 0.05 ether);

        assertFalse(c.graduated());
        vm.expectRevert(C.NotGraduated.selector);
        c.buyToken();

        // pre-graduation burn pays ETH incl. queued share
        uint256[] memory one = new uint256[](1);
        one[0] = 19;
        vm.prank(alice);
        (uint256 e0,) = c.redeem(one);
        console2.log("pre-grad redeem ETH", e0);
        assertEq(e0, 0.005 ether);

        // graduate MOON on the fork with one large curve buy
        console2.log("MOON phase", ICurve(MOON_LAUNCH).phase());
        console2.log("threshold", ICurve(MOON_LAUNCH).graduationThreshold());
        vm.prank(whale);
        ICurve(MOON_LAUNCH).buy{value: 5000 ether}(0);
        assertTrue(ICurve(MOON_LAUNCH).graduated());
        console2.log("graduated on fork; spot sqrtP", c.spotSqrtPriceX96());
        assertEq(_hook(), HOOK_OLD);
        console2.log("MOON hook buy fee bps", c.buyFeeBps());

        c.observePrice();
        vm.expectRevert(C.NoFreshObservation.selector);
        c.buyToken();
        skip(6 minutes);
        uint256 pend = c.pendingEth();
        g = gasleft();
        (uint256 ethIn, uint256 out) = c.buyToken();
        console2.log("buyToken gas", g - gasleft());
        console2.log("ethIn", ethIn);
        console2.log("tokensOut", out);
        assertEq(ethIn, pend < 0.05 ether ? pend : 0.05 ether);
        assertEq(IERC20(MOON).balanceOf(address(c)), out);
        assertEq(c.tokenReserve(), out);

        // manipulation check: a big buy after a fresh observation blocks the next vault buy
        vm.prank(alice);
        c.mint{value: 0.2 ether}(20);
        skip(11 minutes);
        c.observePrice();
        skip(6 minutes);
        PoolSwapTest sw = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        PoolKey memory key = IHookInfo(c.launch() == MOON_LAUNCH ? _hook() : address(0)).poolKeyOf(MOON_LAUNCH);
        vm.prank(whale);
        sw.swap{value: 50 ether}(
            key,
            IPoolManager.SwapParams(true, -int256(50 ether), TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        console2.log("spot after whale buy", c.spotSqrtPriceX96());
        vm.expectRevert(C.PriceMoved.selector);
        c.buyToken();

        // burn pays ETH + MOON
        uint256[] memory ids = new uint256[](10);
        for (uint256 i; i < 10; i++) {
            ids[i] = i;
        }
        (uint256 ePer, uint256 tPer) = c.redeemValuePerNft();
        console2.log("per NFT ETH", ePer);
        console2.log("per NFT MOON", tPer);
        g = gasleft();
        vm.prank(alice);
        (uint256 e, uint256 t) = c.redeem(ids);
        console2.log("redeem 10 gas", g - gasleft());
        console2.log("redeem ETH", e);
        console2.log("redeem MOON", t);
        assertEq(IERC20(MOON).balanceOf(alice), t);
        assertGt(t, 0);

        c.withdrawCreator();
        c.withdrawPlatform();
        assertEq(address(c).balance, c.ethFloor() + c.pendingEth());
    }
}

