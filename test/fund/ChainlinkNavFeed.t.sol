// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChainlinkNavFeed} from "../../src/fund/phase2/ChainlinkNavFeed.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";

contract MockAggregator {
    uint8 public decimals;
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;

    constructor(uint8 _decimals) {
        decimals = _decimals;
    }

    function setRound(uint80 round, int256 ans, uint256 started, uint256 updated, uint80 answered) external {
        roundId = round;
        answer = ans;
        startedAt = started;
        updatedAt = updated;
        answeredInRound = answered;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}

contract ChainlinkNavFeedTest is Test {
    address token = makeAddr("token");
    MockAggregator assetUsd;
    MockAggregator ethUsd;
    MockAggregator sequencer;

    function setUp() public {
        vm.warp(1_000_000);
        assetUsd = new MockAggregator(8);
        ethUsd = new MockAggregator(8);
        sequencer = new MockAggregator(0);
        // 1 USDC = 1 USD, 1 ETH = 2000 USD. Token has 6 decimals.
        assetUsd.setRound(4, 1e8, block.timestamp, block.timestamp, 4);
        ethUsd.setRound(9, 2000e8, block.timestamp, block.timestamp, 9);
        sequencer.setRound(1, 0, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);
    }

    function _open(uint8 tokenDecimals) internal returns (ChainlinkNavFeed feed) {
        feed = new ChainlinkNavFeed(token, tokenDecimals, address(assetUsd), address(ethUsd), false, address(0), 0);
    }

    function test_divides_usd_feeds_into_eth_per_raw_unit() public {
        ChainlinkNavFeed feed = _open(6);
        (uint256 px, uint64 at) = feed.latestPrice(token);
        // 1e6 raw = 1 token = 1/2000 ETH. priceX18 is ETH wei per 1e18 raw.
        assertEq(px, 1e18 * 1e18 / 2000 / 1e6);
        assertEq(at, block.timestamp);
        assertEq(feed.datasetHeartbeat(), 86_400);
    }

    function test_wbtc_eight_decimals_and_eth_over_itself() public {
        assetUsd.setRound(4, 40_000e8, block.timestamp, block.timestamp, 4);
        ChainlinkNavFeed btc = _open(8);
        (uint256 px,) = btc.latestPrice(token);
        assertEq(px, 20e18 * 1e18 / 1e8);

        ChainlinkNavFeed eth = new ChainlinkNavFeed(token, 18, address(ethUsd), address(ethUsd), false, address(0), 0);
        (uint256 one,) = eth.latestPrice(token);
        assertEq(one, 1e18);
    }

    function test_older_leg_sets_the_timestamp() public {
        assetUsd.setRound(4, 1e8, block.timestamp, block.timestamp - 30 minutes, 4);
        ChainlinkNavFeed feed = _open(6);
        (, uint64 at) = feed.latestPrice(token);
        assertEq(at, block.timestamp - 30 minutes);
    }

    function test_rejects_bad_rounds_and_a_missing_outage_guard() public {
        ChainlinkNavFeed feed = _open(6);
        assetUsd.setRound(5, 1e8, block.timestamp, block.timestamp, 4);
        vm.expectRevert(ChainlinkNavFeed.PriceUnavailable.selector);
        feed.latestPrice(token);
        ethUsd.setRound(9, 0, block.timestamp, block.timestamp, 9);
        assetUsd.setRound(4, 1e8, block.timestamp, block.timestamp, 4);
        vm.expectRevert(ChainlinkNavFeed.PriceUnavailable.selector);
        feed.latestPrice(token);

        vm.expectRevert(ChainlinkNavFeed.WrongAsset.selector);
        feed.latestPrice(makeAddr("other"));
        vm.expectRevert(ChainlinkNavFeed.OutageGuardMissing.selector);
        new ChainlinkNavFeed(token, 6, address(assetUsd), address(ethUsd), true, address(0), 1 hours);
    }

    function test_sequencer_down_grace_and_up() public {
        ChainlinkNavFeed feed =
            new ChainlinkNavFeed(token, 6, address(assetUsd), address(ethUsd), true, address(sequencer), 1 hours);
        sequencer.setRound(2, 1, block.timestamp - 1 days, block.timestamp, 2);
        vm.expectRevert(ChainlinkNavFeed.SequencerDown.selector);
        feed.latestPrice(token);
        sequencer.setRound(3, 0, block.timestamp - 1 minutes, block.timestamp, 3);
        vm.expectRevert(ChainlinkNavFeed.SequencerGrace.selector);
        feed.latestPrice(token);
        sequencer.setRound(3, 0, block.timestamp - 2 hours, block.timestamp, 3);
        (uint256 px,) = feed.latestPrice(token);
        assertGt(px, 0);
    }

    function test_trading_bound_rejects_a_price_inside_the_dataset_heartbeat() public {
        uint256 age = 2 hours;
        ChainlinkNavFeed beat = _open(18);
        assertLt(age, beat.datasetHeartbeat());
        assetUsd.setRound(4, 1e8, block.timestamp - age, block.timestamp - age, 4);
        ethUsd.setRound(9, 2000e8, block.timestamp - age, block.timestamp - age, 9);
        ChainlinkNavFeed feed = _open(18);
        address[] memory routers = new address[](0);
        FundAllowlist.AssetInit[] memory assets = new FundAllowlist.AssetInit[](2);
        assets[0] = FundAllowlist.AssetInit(makeAddr("weth"), true, address(0), 0, 0, 0);
        assets[1] = FundAllowlist.AssetInit(token, false, address(feed), 1 hours, 1, type(uint256).max);
        FundAllowlist list = new FundAllowlist(address(this), 1 days, routers, assets);
        uint64 heartbeat = uint64(feed.datasetHeartbeat());
        vm.expectRevert(FundAllowlist.BadDelay.selector);
        // 86400 cannot be configured as the trading staleness bound.
        list.proposeAsset(makeAddr("other"), address(feed), heartbeat, 1, 2);
        vm.expectRevert(FundAllowlist.PriceStale.selector);
        list.quote(token, 1e18);
    }
}
