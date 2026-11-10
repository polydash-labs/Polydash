// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryPhase3} from "../../src/fund/phase3/FundFactoryPhase3.sol";
import {FundNFTPhase3} from "../../src/fund/phase3/FundNFTPhase3.sol";
import {FundSwapFacetPhase3} from "../../src/fund/phase3/FundSwapFacetPhase3.sol";
import {FundVaultPhase3} from "../../src/fund/phase3/FundVaultPhase3.sol";
import {StrategyTemplate} from "../../src/fund/phase3/StrategyTemplate.sol";
import {FundCarryRights} from "../../src/fund/phase5/FundCarryRights.sol";
import {FundConvictionLock} from "../../src/fund/phase5/FundConvictionLock.sol";
import {FundNavFloor} from "../../src/fund/phase5/FundNavFloor.sol";
import {FundPhase5} from "../../src/fund/phase5/FundPhase5.sol";
import {FundSecondaryMarket} from "../../src/fund/phase5/FundSecondaryMarket.sol";
import {FundShareRenderer} from "../../src/fund/phase5/FundShareRenderer.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed, MockWETH, RateRouter} from "./InvestMocks.sol";

contract Phase5Fixture is Test {
    MockWETH internal weth;
    MockERC20 internal asset;
    MockFeed internal feed;
    RateRouter internal router;
    FundAllowlist internal allow;
    StrategyTemplate internal templates;
    FundFactoryPhase3 internal factory;
    FundPhase5 internal phase5;
    FundSecondaryMarket internal market;
    FundShareRenderer internal renderer;
    FundConvictionLock internal locks;
    FundCarryRights internal carry;
    FundNavFloor internal floor;
    uint256 internal templateId;

    address internal manager = makeAddr("manager");
    address internal buyer = makeAddr("buyer");
    address internal buyer2 = makeAddr("buyer2");

    function setUp() public virtual {
        weth = new MockWETH();
        asset = new MockERC20("Alpha", "ALP", 0);
        feed = new MockFeed();
        feed.setPrice(1e18);
        router = new RateRouter(1e18, 1e18);
        asset.transfer(address(router), 1000 ether);
        vm.deal(address(router), 100 ether);
        vm.deal(manager, 50 ether);
        vm.deal(buyer, 50 ether);
        vm.deal(buyer2, 50 ether);

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        FundAllowlist.AssetInit[] memory seeded = new FundAllowlist.AssetInit[](2);
        seeded[0] = FundAllowlist.AssetInit(address(weth), true, address(0), 0, 0, 0);
        seeded[1] = FundAllowlist.AssetInit(address(asset), false, address(feed), 1 hours, 0.1e18, 10e18);
        allow = new FundAllowlist(address(this), 1 days, routers, seeded);

        templates = new StrategyTemplate(address(this));
        address[] memory universe = new address[](1);
        universe[0] = address(asset);
        templateId = templates.publish(
            keccak256("mandate"), "ipfs://phase5-mandate", universe, 7500, 7500, 5000, 1000, 1000, 7 days
        );
        factory = new FundFactoryPhase3(
            address(this), address(allow), address(weth), address(new FundSwapFacetPhase3()), address(templates)
        );
        phase5 = new FundPhase5(address(factory));
        market = FundSecondaryMarket(payable(phase5.market()));
        renderer = FundShareRenderer(phase5.renderer());
        locks = FundConvictionLock(payable(phase5.locks()));
        carry = FundCarryRights(payable(phase5.carry()));
        floor = FundNavFloor(payable(phase5.navFloor()));
    }

    function _create(
        uint256 price,
        uint256 cap,
        uint256 entryBps,
        uint256 skinBps,
        uint256 duration,
        string memory name
    ) internal returns (FundNFTPhase3 nft) {
        vm.prank(manager);
        nft = FundNFTPhase3(
            factory.createFund(
                FundFactoryPhase3.Params({
                    templateId: templateId,
                    name: name,
                    symbol: "P5",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: price,
                    raiseCap: cap,
                    entryFeeBps: entryBps,
                    minSkinBps: skinBps,
                    raiseDuration: duration
                })
            )
        );
    }

    function _open() internal returns (FundNFTPhase3 nft, FundVaultPhase3 vault) {
        nft = _create(1 ether, 2 ether, 0, 5000, 30 days, "Phase5");
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
    }

    function _ids(uint256 tokenId) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = tokenId;
    }
}
