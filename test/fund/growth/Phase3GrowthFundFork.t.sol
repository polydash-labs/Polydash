// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolydashTwapFeed} from "src/fund/growth/PolydashTwapFeed.sol";
import {UniswapV4RouterAdapter} from "src/fund/growth/UniswapV4RouterAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Phase3GrowthFundForkTest (not reviewed, not deployed)
/// @notice Fund-level fork integration for the Polydash Growth Fund Season 1 adapters.
///         Runs against Robinhood Chain mainnet state at a pinned block via dRPC.
///         The full loop, all on the fork (nothing is deployed to mainnet):
///           1. Deploy PolydashTwapFeed + UniswapV4RouterAdapter.
///           2. Poke the feed until it spans its 30-minute TWAP window.
///           3. Prank the allowlist owner (0x9a21...): proposeAsset(POLYDASH, feed, ...) and
///              propose(adapter as router), warp past the 2-day timelock, execute both.
///           4. Prank the template owner: publish Template #2 with assets [POLYDASH]
///              (WETH is the quote asset and is always in the mandate implicitly).
///           5. Create a Phase 3 fund (0.01 ETH mint, 0.1 ETH cap, 5% skin), mint skin +
///              public shares, enable investing.
///           6. Re-poke the feed (the timelock warp staled the first observations), then have
///              the manager buy POLYDASH with ETH through the vault + adapter, and sell half
///              back. Every step asserts on-chain state.
///         Pinned block: 110526500 (same block the adapter fork tests use; dRPC serves it).
///         Run: `forge test --match-path test/fund/growth/Phase3GrowthFundFork.t.sol -j 1 -vvv`
interface IFactoryPhase3 {
    struct Params {
        uint256 templateId;
        string name;
        string symbol;
        string imageUri;
        string baseURI;
        uint256 mintPrice;
        uint256 raiseCap;
        uint256 entryFeeBps;
        uint256 minSkinBps;
        uint256 raiseDuration;
    }

    function createFund(Params calldata p) external returns (address fund);
}

interface ITemplates {
    function publish(
        bytes32 mandateHash,
        string calldata mandateUri,
        address[] calldata assets,
        uint256 maxPositionBps,
        uint256 maxTradeBps,
        uint256 maxDeviationBps,
        uint256 hwmFeeBps,
        uint256 maxDrawdownBps,
        uint64 skinLock
    ) external returns (uint256 id);
    function owner() external view returns (address);
    function templateCount() external view returns (uint256);
}

interface IAllowlist {
    function proposeAsset(address asset, address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)
        external
        returns (uint256 id);
    function propose(address target, bool isRouter, bool allowed) external returns (uint256 id);
    function execute(uint256 id) external;
    function assetAllowed(address asset) external view returns (bool);
    function routerAllowed(address router) external view returns (bool);
    function delay() external view returns (uint256);
    function owner() external view returns (address);
}

interface IVaultPhase3 {
    function status() external view returns (uint8);
    function nft() external view returns (address);
    function raiseDeadline() external view returns (uint64);
    function enableInvesting() external;
    function swap(
        address router,
        address assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external;
    function navPerNft() external view returns (uint256);
}

interface INFTPhase3 {
    function mint(uint256 qty) external payable;
    function vault() external view returns (address);
    function totalMinted() external view returns (uint256);
    function managerMinted() external view returns (uint256);
    function skinRequired() external view returns (uint256);
    function publicOpen() external view returns (bool);
    function outstanding() external view returns (uint256);
}

contract Phase3GrowthFundForkTest is Test {
    uint256 constant FORK_BLOCK = 110_526_500;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address constant HOOK = 0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc;
    address constant FACTORY = 0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B;
    address constant TEMPLATES = 0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba;
    address constant ALLOWLIST = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address constant OWNER = 0x9a21c75aC263cC43125E70200636f6397f8776d0;

    // Recommended allowlist band for POLYDASH (see PolydashTwapFeed report).
    uint64 constant MAX_STALE = 3600;
    uint256 constant MIN_PRICE_X18 = 60_000_000;
    uint256 constant MAX_PRICE_X18 = 260_000_000;

    PolydashTwapFeed feed;
    UniswapV4RouterAdapter adapter;

    address manager = makeAddr("manager");
    address investor = makeAddr("investor");

    function setUp() public {
        vm.createSelectFork("https://robinhood.drpc.org", FORK_BLOCK);
        feed = new PolydashTwapFeed(POOL_MANAGER, POLYDASH, WETH, HOOK, 0x800000, 200, 1800, 1800);
        adapter = new UniswapV4RouterAdapter(POOL_MANAGER, WETH, POLYDASH, HOOK, 0x800000, 200);
        vm.deal(manager, 10 ether);
        vm.deal(investor, 10 ether);
    }

    /// @notice Three pokes 15 minutes apart, so observations span the 30-minute TWAP window.
    function _pokeThrice() internal {
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 900);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 900);
        feed.poke();
    }

    function test_fullLoop() public {
        // 1. Feed must have a full window of observations before the allowlist will take it.
        _pokeThrice();
        (uint256 twapPrice, uint64 updatedAt) = feed.latestPrice(POLYDASH);
        assertGt(twapPrice, MIN_PRICE_X18);
        assertLt(twapPrice, MAX_PRICE_X18);
        assertEq(updatedAt, vm.getBlockTimestamp());
        emit log_named_uint("twap priceX18", twapPrice);

        // 2. Allowlist: register the feed + POLYDASH, allow the adapter as a router.
        assertEq(IAllowlist(ALLOWLIST).owner(), OWNER);
        assertEq(ITemplates(TEMPLATES).owner(), OWNER);
        vm.startPrank(OWNER);
        uint256 idAsset =
            IAllowlist(ALLOWLIST).proposeAsset(POLYDASH, address(feed), MAX_STALE, MIN_PRICE_X18, MAX_PRICE_X18);
        uint256 idRouter = IAllowlist(ALLOWLIST).propose(address(adapter), true, true);
        vm.stopPrank();

        // 3. Warp past the 2-day timelock and execute both proposals.
        vm.warp(vm.getBlockTimestamp() + IAllowlist(ALLOWLIST).delay() + 1);
        IAllowlist(ALLOWLIST).execute(idAsset);
        IAllowlist(ALLOWLIST).execute(idRouter);
        assertTrue(IAllowlist(ALLOWLIST).assetAllowed(POLYDASH));
        assertTrue(IAllowlist(ALLOWLIST).routerAllowed(address(adapter)));

        // 4. Publish Template #2: [POLYDASH] only — WETH is the quote asset and the
        //    factory rejects it in the template asset list (`_checkAssets`); WETH is
        //    always in the mandate implicitly. 80% max position, 10% max trade,
        //    5% deviation, 5% HWM fee, 20% drawdown brake, 30-day skin lock.
        address[] memory assets = new address[](1);
        assets[0] = POLYDASH;
        vm.prank(OWNER);
        uint256 templateId = ITemplates(TEMPLATES)
            .publish(
                keccak256("polydash-growth-fund-season1-mandate"),
                "ipfs://polydash-growth-fund-season1",
                assets,
                8000,
                1000,
                500,
                500,
                2000,
                30 days
            );
        assertEq(templateId, 2);

        // 5. Create the fund: 0.01 ETH mint, 0.1 ETH cap (10 shares), 5% skin, 1h raise.
        vm.prank(manager);
        address nftAddr = IFactoryPhase3(FACTORY)
            .createFund(
                IFactoryPhase3.Params({
                    templateId: templateId,
                    name: "Polydash Growth Fund",
                    symbol: "PDGF",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 0.01 ether,
                    raiseCap: 0.1 ether,
                    entryFeeBps: 0,
                    minSkinBps: 500,
                    raiseDuration: 1 hours
                })
            );
        address vaultAddr = INFTPhase3(nftAddr).vault();
        assertEq(INFTPhase3(nftAddr).skinRequired(), 1);
        assertEq(IVaultPhase3(vaultAddr).status(), 0); // Raising

        // 6. Manager mints the 1 skin share first; public mint opens; investor takes the rest.
        vm.prank(manager);
        INFTPhase3(nftAddr).mint{value: 0.01 ether}(1);
        assertTrue(INFTPhase3(nftAddr).publicOpen());
        assertEq(INFTPhase3(nftAddr).managerMinted(), 1);
        vm.prank(investor);
        INFTPhase3(nftAddr).mint{value: 0.09 ether}(9);
        assertEq(INFTPhase3(nftAddr).totalMinted(), 10);
        assertEq(IVaultPhase3(vaultAddr).status(), 1); // RaisingClosed

        // 7. Manager enables investing.
        vm.prank(manager);
        IVaultPhase3(vaultAddr).enableInvesting();
        assertEq(IVaultPhase3(vaultAddr).status(), 2); // Investing

        // 8. The timelock warp staled the first observations; re-poke for a fresh TWAP.
        _pokeThrice();
        (twapPrice,) = feed.latestPrice(POLYDASH);
        assertGt(twapPrice, MIN_PRICE_X18);

        // 9. Buy POLYDASH with 0.005 ETH (small vs the thin pool: ~3% expected deviation,
        //    inside the template's 5% band). ~39,600 POLYDASH expected; floor at 35,000.
        uint256 ethBefore = address(vaultAddr).balance;
        vm.prank(manager);
        IVaultPhase3(vaultAddr).swap(address(adapter), address(0), POLYDASH, 0.005 ether, 35_000e18, "");
        uint256 polydashBal = IERC20(POLYDASH).balanceOf(vaultAddr);
        assertGe(polydashBal, 35_000e18);
        assertLt(address(vaultAddr).balance, ethBefore);
        emit log_named_uint("vault POLYDASH after buy", polydashBal);
        emit log_named_uint("vault navPerNft after buy", IVaultPhase3(vaultAddr).navPerNft());

        // 10. Sell half back for ETH: the round trip works at fund level.
        uint256 sellAmount = polydashBal / 2;
        uint256 ethBeforeSell = address(vaultAddr).balance;
        vm.prank(manager);
        IVaultPhase3(vaultAddr).swap(address(adapter), POLYDASH, address(0), sellAmount, 0.002 ether, "");
        assertLt(IERC20(POLYDASH).balanceOf(vaultAddr), polydashBal);
        assertGt(address(vaultAddr).balance, ethBeforeSell);
        emit log_named_uint("vault POLYDASH after sell", IERC20(POLYDASH).balanceOf(vaultAddr));
        emit log_named_uint("vault navPerNft after sell", IVaultPhase3(vaultAddr).navPerNft());
    }
}
