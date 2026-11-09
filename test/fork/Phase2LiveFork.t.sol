// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChainlinkNavFeed} from "../../src/fund/phase2/ChainlinkNavFeed.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../src/fund/phase2/FundFactoryInvest.sol";
import {FundNFTInvest} from "../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../src/fund/phase2/FundVaultInvest.sol";
import {FundVaultStore} from "../../src/fund/phase2/FundVaultStore.sol";
import {UniswapV3RouterAdapter} from "../../src/fund/phase2/UniswapV3RouterAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed} from "../fund/InvestMocks.sol";

/// @notice Fork coverage against the live Phase 2 deployment. Nothing is broadcast.
///         State changes exist only on the local fork. Run with FORK_RPC set.
contract Phase2LiveForkTest is Test {
    address constant OWNER = 0x9a21c75aC263cC43125E70200636f6397f8776d0;
    address constant FACTORY = 0xd3c6ae470c25989cC8d2876c1855fB570B98894E;
    address constant ALLOW = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address constant FACET = 0xA2620b14d1A39d4afbEAA4b87a7E7871050b50a0;
    address constant ADAPTER = 0xA5187f8e56Dd0784624D833CEE3bF6f2Aa5E7581;
    address constant VAULT_DEPLOYER = 0x111aC00A91944477141aDe12ebB6BcB0CEFC3a95;
    address constant NFT_DEPLOYER = 0x5766A7A937D0De897C2d90df0D045f9067fd72D5;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant SWAP_ROUTER02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_USD = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    address constant ETH_USD = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    address constant QUOTER = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address constant PHASE1 = 0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878;

    FundFactoryInvest factory;
    FundAllowlist allow;
    bool on;
    bytes32 phase1Code;
    bytes32 factoryCode;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        if (block.chainid != 4663) return;
        on = true;
        factory = FundFactoryInvest(FACTORY);
        allow = FundAllowlist(ALLOW);
        phase1Code = PHASE1.codehash;
        factoryCode = FACTORY.codehash;
    }

    function test_live_config() public view {
        if (!on) return;
        assertEq(factory.owner(), OWNER);
        assertEq(factory.pendingOwner(), address(0));
        assertEq(factory.feeRecipient(), OWNER);
        assertEq(factory.weth(), WETH);
        assertEq(address(factory.allowlist()), ALLOW);
        assertEq(factory.swapFacet(), FACET);
        assertEq(address(factory.vaultDeployer()), VAULT_DEPLOYER);
        assertEq(address(factory.nftDeployer()), NFT_DEPLOYER);
        assertEq(factory.allFundsLength(), 0);
        assertEq(factory.PROTOCOL_FEE_BPS(), 20);
        assertGt(VAULT_DEPLOYER.code.length, 0);
        assertGt(NFT_DEPLOYER.code.length, 0);

        assertEq(allow.owner(), OWNER);
        assertEq(allow.pendingOwner(), address(0));
        assertEq(allow.delay(), 172_800);
        assertEq(allow.MIN_DELAY(), 1 days);
        assertEq(allow.MAX_STALE(), 1 days);
        assertFalse(allow.paused());
        assertEq(allow.quoteAsset(), WETH);
        assertEq(allow.proposalCount(), 0);
        assertEq(allow.routerCount(), 1);
        assertEq(allow.assetCount(), 1);
        assertEq(allow.routers(0), ADAPTER);
        assertEq(allow.assets(0), WETH);
        assertTrue(allow.routerAllowed(ADAPTER));
        assertFalse(allow.routerAllowed(SWAP_ROUTER02));
        assertTrue(allow.assetAllowed(WETH));
        (address wethFeed,,,) = allow.feedOf(WETH);
        assertEq(wethFeed, address(0));

        UniswapV3RouterAdapter adapter = UniswapV3RouterAdapter(payable(ADAPTER));
        assertEq(address(adapter.router()), SWAP_ROUTER02);
        assertEq(adapter.weth(), WETH);
        assertEq(FACET.code.length, 8700);
    }

    function test_live_lifecycle() public {
        if (!on) return;

        address manager = makeAddr("manager");
        address stranger = makeAddr("stranger");
        address executor = makeAddr("executor");
        vm.deal(manager, 20 ether);
        vm.deal(stranger, 1 ether);

        // Failed raise: fees stay in the vault, the holder receives spendable ETH only.
        FundNFTInvest failed =
            _create(manager, "Fail", "FAIL", 1 ether, 2 ether, 100, 10_000, 1 hours, new address[](0));
        vm.prank(manager);
        failed.mint{value: 1 ether}(1);
        FundVaultInvest failedVault = failed.vault();
        assertEq(failedVault.protocolFeeBps(), 20);
        assertEq(failedVault.claimableProtocolFee(), 0.002 ether);
        assertEq(failedVault.claimableEntryFee(), 0.01 ether);
        assertEq(failedVault.spendableEth(), 0.988 ether);

        MockERC20 mock = new MockERC20("Mock", "MCK", 0);
        MockFeed mockFeed = new MockFeed();
        mockFeed.setPrice(1e18);
        HostileRouter hostile = new HostileRouter();

        (uint256 quoted,,,) = IQuoterV2(QUOTER)
            .quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                    tokenIn: WETH, tokenOut: USDG, amountIn: 0.5 ether, fee: 500, sqrtPriceLimitX96: 0
                })
            );
        assertGt(quoted, 800e6);
        uint256 execPrice = (0.5 ether * 1e18) / quoted;
        MockFeed usdgFeed = new MockFeed();
        usdgFeed.setPrice(execPrice);

        // Requiring a sequencer with no feed reverts. The live allowlist does not set a feed.
        vm.expectRevert(ChainlinkNavFeed.OutageGuardMissing.selector);
        new ChainlinkNavFeed(USDG, 6, USDG_USD, ETH_USD, true, address(0), 0);
        // Sequencer-off feed reads before the timelock warp. The warp would age the rounds past one day.
        ChainlinkNavFeed liveFeed = new ChainlinkNavFeed(USDG, 6, USDG_USD, ETH_USD, false, address(0), 0);
        (uint256 livePrice, uint64 liveAt) = liveFeed.latestPrice(USDG);
        assertGt(livePrice, 0);
        assertGt(liveAt, 0);
        assertLe(block.timestamp - liveAt, 1 days);

        vm.prank(stranger);
        vm.expectRevert(FundAllowlist.NotOwner.selector);
        allow.propose(address(hostile), true, true);

        vm.startPrank(OWNER);
        uint256 routerId = allow.propose(address(hostile), true, true);
        uint256 mockId = allow.proposeAsset(address(mock), address(mockFeed), 1 days, 0.5e18, 2e18);
        uint256 usdgId = allow.proposeAsset(USDG, address(usdgFeed), 1 days, execPrice / 2, execPrice * 2);
        vm.stopPrank();
        (,,, uint64 readyAt,,,,,,) = allow.proposals(routerId);
        assertEq(readyAt, uint64(block.timestamp + 172_800));
        vm.expectRevert(FundAllowlist.Timelock.selector);
        allow.execute(routerId);
        vm.warp(readyAt - 1);
        vm.expectRevert(FundAllowlist.Timelock.selector);
        allow.execute(routerId);
        vm.warp(readyAt);
        allow.execute(routerId);
        allow.execute(mockId);
        allow.execute(usdgId);
        assertTrue(allow.routerAllowed(address(hostile)));
        assertTrue(allow.assetAllowed(address(mock)));
        assertTrue(allow.assetAllowed(USDG));
        assertFalse(allow.routerAllowed(SWAP_ROUTER02));

        vm.prank(OWNER);
        vm.expectRevert(FundAllowlist.BadDelay.selector);
        allow.setDelay(172_799);
        assertEq(allow.delay(), 172_800);

        failedVault.failRaise();
        uint256[] memory one = new uint256[](1);
        one[0] = 1;
        uint256 managerBefore = manager.balance;
        vm.prank(manager);
        failed.refund(one);
        assertEq(manager.balance - managerBefore, 0.988 ether);
        assertEq(failedVault.spendableEth(), 0);
        assertEq(address(failedVault).balance, 0.012 ether);
        vm.prank(manager);
        failedVault.withdrawEntryFee();
        uint256 feeBefore = OWNER.balance;
        failedVault.withdrawProtocolFee();
        assertEq(OWNER.balance - feeBefore, 0.002 ether);
        assertEq(address(failedVault).balance, 0);

        // Hostile router cannot keep the vault's ETH. Reentrancy into fee withdrawal is caught.
        address[] memory mockUniverse = new address[](1);
        mockUniverse[0] = address(mock);
        FundNFTInvest gated = _create(manager, "Gate", "GATE", 1 ether, 1 ether, 0, 10_000, 7 days, mockUniverse);
        vm.prank(manager);
        gated.mint{value: 1 ether}(1);
        FundVaultInvest gatedVault = gated.vault();
        vm.prank(manager);
        gatedVault.enableInvesting();
        vm.prank(stranger);
        vm.expectRevert(FundVaultStore.NotAuthorized.selector);
        gatedVault.swap(address(0), address(0), WETH, 0.1 ether, 0.1 ether, "");
        vm.prank(manager);
        gatedVault.setExecutor(executor, true);
        vm.deal(executor, 1 ether);
        vm.prank(executor);
        gatedVault.swap(address(0), address(0), WETH, 0.1 ether, 0.1 ether, "");
        assertEq(IERC20(WETH).balanceOf(address(gatedVault)), 0.1 ether);
        vm.prank(executor);
        vm.expectRevert(FundVaultStore.NotManager.selector);
        gatedVault.withdrawEntryFee();
        vm.prank(executor);
        vm.expectRevert(FundVaultStore.NotManager.selector);
        gatedVault.setPayoutWallet(executor);
        vm.prank(executor);
        gatedVault.swap(address(0), WETH, address(0), 0.1 ether, 0.1 ether, "");
        assertEq(IERC20(WETH).balanceOf(address(gatedVault)), 0);

        uint256 gatedBal = address(gatedVault).balance;
        vm.expectRevert();
        vm.prank(manager);
        gatedVault.swap(address(hostile), address(0), address(mock), 0.2 ether, 1, "");
        assertEq(address(gatedVault).balance, gatedBal);
        assertEq(IERC20(address(mock)).balanceOf(address(gatedVault)), 0);

        // Successful raise, 1:1 wrap, live adapter swap, NAV, pro-rata exit.
        ExitHolder buyer = new ExitHolder();
        vm.deal(address(buyer), 2 ether);
        address[] memory usdgUniverse = new address[](1);
        usdgUniverse[0] = USDG;
        FundNFTInvest nft = _create(manager, "Live", "LIVE", 1 ether, 2 ether, 0, 5000, 7 days, usdgUniverse);
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        buyer.mint{value: 1 ether}(nft);
        FundVaultInvest vault = nft.vault();
        buyer.setVault(vault);
        assertEq(vault.protocolFeeBps(), 20);
        assertEq(vault.claimableProtocolFee(), 0.004 ether);
        vm.prank(manager);
        vault.enableInvesting();

        vm.prank(OWNER);
        allow.pause();
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Paused.selector);
        vault.swap(address(0), address(0), WETH, 0.1 ether, 0.1 ether, "");
        vm.prank(OWNER);
        allow.unpause();

        uint256 ethBeforeWrap = address(vault).balance;
        vm.prank(manager);
        vault.swap(address(0), address(0), WETH, 0.2 ether, 0.2 ether, "");
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0.2 ether);
        assertEq(ethBeforeWrap - address(vault).balance, 0.2 ether);
        vm.prank(manager);
        vault.swap(address(0), WETH, address(0), 0.2 ether, 0.2 ether, "");
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0);
        assertEq(address(vault).balance, ethBeforeWrap);

        uint256 navBefore = vault.nav();
        vm.prank(manager);
        vault.swap(ADAPTER, address(0), USDG, 0.5 ether, 800e6, abi.encode(uint24(500)));
        uint256 usdgHeld = IERC20(USDG).balanceOf(address(vault));
        assertGt(usdgHeld, 800e6);
        assertLt(usdgHeld, quoted + (quoted / 20) + 1);
        assertGt(vault.nav(), (navBefore * 90) / 100);
        assertLt(vault.nav(), (navBefore * 110) / 100);
        assertEq(vault.tradeCount(), 3);

        uint256 fees = vault.claimableProtocolFee();
        uint256 spendable = vault.spendableEth();
        uint256 buyerEth = address(buyer).balance;
        buyer.exit(nft, 2);
        assertEq(buyer.feeHits(), 2);
        assertEq(vault.claimableProtocolFee(), fees);
        assertEq(address(buyer).balance - buyerEth, spendable / 2);
        assertEq(IERC20(USDG).balanceOf(address(buyer)), usdgHeld / 2);

        uint256 managerEth = manager.balance;
        uint256[] memory last = new uint256[](1);
        last[0] = 1;
        vm.prank(manager);
        nft.exit(last);
        assertEq(vault.spendableEth(), 0);
        assertEq(IERC20(USDG).balanceOf(address(vault)), 0);
        assertEq(manager.balance - managerEth, spendable - spendable / 2);
        assertEq(IERC20(USDG).balanceOf(manager), usdgHeld - usdgHeld / 2);
        assertEq(address(vault).balance, fees);

        assertEq(PHASE1.codehash, phase1Code);
        assertEq(FACTORY.codehash, factoryCode);
    }

    function _create(
        address manager,
        string memory name,
        string memory symbol,
        uint256 price,
        uint256 cap,
        uint256 entryBps,
        uint256 skinBps,
        uint256 duration,
        address[] memory assets
    ) internal returns (FundNFTInvest nft) {
        vm.prank(manager);
        nft = FundNFTInvest(
            factory.createFund(
                FundFactoryInvest.Params({
                    name: name,
                    symbol: symbol,
                    imageUri: "",
                    baseURI: "",
                    mintPrice: price,
                    raiseCap: cap,
                    entryFeeBps: entryBps,
                    minSkinBps: skinBps,
                    raiseDuration: duration,
                    mandateHash: keccak256(bytes(name)),
                    assets: assets,
                    mandateUri: "ipfs://phase2-live-scan",
                    maxPositionBps: 0,
                    maxTradeBps: 0,
                    maxDeviationBps: 0
                })
            )
        );
    }
}

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

/// @dev Keeps the input and tries to reenter the vault. The outer swap must revert.
contract HostileRouter {
    function swap(address, address, uint256, uint256, bytes calldata) external payable returns (uint256) {
        try FundVaultInvest(payable(msg.sender)).withdrawProtocolFee() {} catch {}
        return 0;
    }
}

/// @dev Public buyer. On the exit ETH payment it tries to pull the protocol fee. The guard must revert that call.
contract ExitHolder {
    FundVaultInvest public vault;
    uint256 public feeHits;

    function setVault(FundVaultInvest next) external {
        vault = next;
    }

    function mint(FundNFTInvest nft) external payable {
        nft.mint{value: msg.value}(1);
    }

    function exit(FundNFTInvest nft, uint256 id) external {
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        nft.exit(ids);
    }

    receive() external payable {
        try vault.withdrawProtocolFee() {
            feeHits = 1;
        } catch {
            feeHits = 2;
        }
    }
}
