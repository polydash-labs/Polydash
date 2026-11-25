// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundAllowlist} from "../../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../../src/fund/phase2/FundFactoryInvest.sol";
import {FundSwapFacet} from "../../../src/fund/phase2/FundSwapFacet.sol";
import {FundNFTInvest} from "../../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../../src/fund/phase2/FundVaultInvest.sol";
import {AgentExecutor} from "../../../src/fund/phase4/AgentExecutor.sol";
import {AgentRegistry} from "../../../src/fund/phase4/AgentRegistry.sol";
import {Instruction, StrategyParams} from "../../../src/fund/phase4/AgentTypes.sol";
import {MockERC20} from "../../mocks/MockERC20.sol";
import {MockFeed, MockWETH, RateRouter} from "../InvestMocks.sol";

/// @notice Shared non-fork setup for the Phase 4 tests: one allowlist (WETH quote, alpha and
///         beta priced at 1 ETH), one factory, one RateRouter, and EIP-712 signing helpers.
///         Test keys only; nothing here touches mainnet.
abstract contract Phase4Setup is Test {
    bytes32 internal constant INSTRUCTION_TYPEHASH = keccak256(
        "Instruction(address vault,address router,address assetIn,address assetOut,uint256 amountIn,uint256 minAmountOut,bytes data,uint256 deadline,uint256 nonce)"
    );

    FundAllowlist internal allowlist;
    FundFactoryInvest internal factory;
    AgentRegistry internal registry;
    MockWETH internal weth;
    MockERC20 internal alpha;
    MockERC20 internal beta;
    RateRouter internal router;
    MockFeed internal feed;

    address internal manager = makeAddr("manager");
    address internal alice = makeAddr("alice");
    address internal feeTo = makeAddr("fee");
    uint256 internal agentPk = 0xA6E17;
    address internal agentKey;

    bytes32 internal mandate = keccak256("agent-mandate");

    function setUp() public virtual {
        // Foundry starts at timestamp 1, which is below every rebalance interval; warp to a
        // realistic time so the first execution is not rejected as too soon.
        vm.warp(1_800_000_000);
        agentKey = vm.addr(agentPk);
        weth = new MockWETH();
        alpha = new MockERC20("Alpha", "ALP", 0);
        beta = new MockERC20("Beta", "BET", 0);
        router = new RateRouter(1e18, 1e18);
        feed = new MockFeed();

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        FundAllowlist.AssetInit[] memory assets = new FundAllowlist.AssetInit[](3);
        assets[0] = _quote(address(weth));
        assets[1] = _priced(address(alpha), feed);
        assets[2] = _priced(address(beta), feed);
        allowlist = new FundAllowlist(address(this), 2 days, routers, assets);
        factory = new FundFactoryInvest(feeTo, address(allowlist), address(weth), address(new FundSwapFacet()));
        registry = new AgentRegistry();

        vm.deal(manager, 1000 ether);
        vm.deal(alice, 1000 ether);
        alpha.transfer(address(router), 1_000_000 ether);
        beta.transfer(address(router), 1_000_000 ether);
        vm.deal(address(router), 1000 ether);
    }

    function _assets() internal view returns (address[] memory assets) {
        assets = new address[](1);
        assets[0] = address(alpha);
    }

    function _params() internal view returns (FundFactoryInvest.Params memory p) {
        p.name = "Agent Fund";
        p.symbol = "AF";
        p.imageUri = "ipfs://image";
        p.baseURI = "ipfs://base/";
        p.mintPrice = 1 ether;
        p.raiseCap = 2 ether;
        p.entryFeeBps = 0;
        p.minSkinBps = 10_000;
        p.raiseDuration = 7 days;
        p.mandateHash = mandate;
        p.mandateUri = "ipfs://agent-mandate";
        p.maxPositionBps = 0;
        p.maxTradeBps = 0;
        p.maxDeviationBps = 0;
        p.assets = _assets();
    }

    function _create(FundFactoryInvest.Params memory p) internal returns (FundNFTInvest nft) {
        vm.prank(manager);
        nft = FundNFTInvest(factory.createFund(p));
    }

    function _fill(FundNFTInvest nft) internal {
        uint256 price = nft.mintPrice();
        if (!nft.publicOpen()) {
            uint256 skin = nft.skinRequired() - nft.managerMinted();
            vm.prank(manager);
            nft.mint{value: price * skin}(skin);
        }
        uint256 left = nft.maxSupply() - nft.totalSupply();
        if (left == 0) return;
        vm.prank(alice);
        nft.mint{value: price * left}(left);
    }

    function _ready(FundNFTInvest nft) internal returns (FundVaultInvest vault) {
        _fill(nft);
        vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
    }

    function _deployExecutor(FundVaultInvest vault, StrategyParams memory params)
        internal
        returns (AgentExecutor executor)
    {
        executor = new AgentExecutor(address(vault), agentKey, params, address(registry));
    }

    function _authorize(FundVaultInvest vault, AgentExecutor executor) internal {
        vm.prank(manager);
        vault.setExecutor(address(executor), true);
    }

    /// @notice A buy instruction (ETH -> alpha) for `executor`, with the executor's next nonce.
    function _buyIx(AgentExecutor executor, uint256 amountIn, uint256 minAmountOut)
        internal
        view
        returns (Instruction memory ix)
    {
        ix.vault = address(executor.vault());
        ix.router = address(router);
        ix.assetIn = address(0);
        ix.assetOut = address(alpha);
        ix.amountIn = amountIn;
        ix.minAmountOut = minAmountOut;
        ix.data = "";
        ix.deadline = block.timestamp + 1 hours;
        ix.nonce = executor.nextNonce();
    }

    /// @notice A sell instruction (alpha -> ETH) for `executor`, with the executor's next nonce.
    function _sellIx(AgentExecutor executor, uint256 amountIn, uint256 minAmountOut)
        internal
        view
        returns (Instruction memory ix)
    {
        ix.vault = address(executor.vault());
        ix.router = address(router);
        ix.assetIn = address(alpha);
        ix.assetOut = address(0);
        ix.amountIn = amountIn;
        ix.minAmountOut = minAmountOut;
        ix.data = "";
        ix.deadline = block.timestamp + 1 hours;
        ix.nonce = executor.nextNonce();
    }

    /// @notice EIP-712 signature over `ix` for `executor`, signed by `pk`.
    function _sign(AgentExecutor executor, uint256 pk, Instruction memory ix) internal view returns (bytes memory) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("PolypadAgentExecutor"),
                keccak256("1"),
                block.chainid,
                address(executor)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                INSTRUCTION_TYPEHASH,
                ix.vault,
                ix.router,
                ix.assetIn,
                ix.assetOut,
                ix.amountIn,
                ix.minAmountOut,
                keccak256(ix.data),
                ix.deadline,
                ix.nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signAgent(AgentExecutor executor, Instruction memory ix) internal view returns (bytes memory) {
        return _sign(executor, agentPk, ix);
    }

    function _executeBuy(AgentExecutor executor, uint256 amountIn, uint256 minAmountOut) internal {
        Instruction memory ix = _buyIx(executor, amountIn, minAmountOut);
        executor.execute(ix, _signAgent(executor, ix));
    }

    function _quote(address asset) internal pure returns (FundAllowlist.AssetInit memory item) {
        item.asset = asset;
        item.quote = true;
    }

    function _priced(address asset, MockFeed feed_) internal pure returns (FundAllowlist.AssetInit memory item) {
        item.asset = asset;
        item.feed = address(feed_);
        item.maxStale = 1 hours;
        item.minPriceX18 = 0.5 ether;
        item.maxPriceX18 = 1.5 ether;
    }

    function _allowRouter(address next) internal {
        uint256 id = allowlist.propose(next, true, true);
        vm.warp(block.timestamp + allowlist.delay());
        allowlist.execute(id);
    }
}
