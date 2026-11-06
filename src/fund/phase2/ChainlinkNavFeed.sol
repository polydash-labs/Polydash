// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFundPriceFeed} from "./Interfaces.sol";

/// @notice Chainlink AggregatorV3 view. This is not IFundPriceFeed.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title ChainlinkNavFeed (not reviewed, not deployed)
/// @notice Quotes one asset in ETH wei per 1e18 raw token units from two USD aggregators:
///         asset/USD divided by ETH/USD. Decimal scaling is not that conversion.
///         `updatedAt` is the older of the two rounds, so a staleness bound sees the staler leg.
///         `DATASET_HEARTBEAT` is the advertised update interval from the public dataset. It is not
///         a trading freshness bound. The allowlist's own `maxStale` is what `nav()` enforces.
///         If `requireSequencer` is set, a sequencer aggregator is required or every read reverts.
///         Robinhood Chain is not on Chainlink's published L2 sequencer list. This source has no
///         sequencer address and does not copy one from another network.
///         The known Shared SVR proxies are not stored here and are not allowlisted.
contract ChainlinkNavFeed is IFundPriceFeed {
    /// @notice Advertised dataset heartbeat, 86400 seconds. Not a trading bound.
    function datasetHeartbeat() external pure returns (uint256) {
        return 86_400;
    }

    address public immutable asset;
    uint8 public immutable tokenDecimals;
    IAggregatorV3 public immutable assetUsd;
    IAggregatorV3 public immutable ethUsd;
    uint8 public immutable assetFeedDecimals;
    uint8 public immutable ethFeedDecimals;
    bool public immutable requireSequencer;
    IAggregatorV3 public immutable sequencer;
    uint256 public immutable sequencerGrace;

    error BadFeed();
    error WrongAsset();
    error PriceUnavailable();
    error OutageGuardMissing();
    error SequencerDown();
    error SequencerGrace();

    constructor(
        address _asset,
        uint8 _tokenDecimals,
        address _assetUsd,
        address _ethUsd,
        bool _requireSequencer,
        address _sequencer,
        uint256 _grace
    ) {
        if (_asset == address(0) || _assetUsd == address(0) || _ethUsd == address(0)) revert BadFeed();
        if (_tokenDecimals > 18) revert BadFeed();
        if (_requireSequencer) {
            if (_sequencer == address(0) || _grace == 0) revert OutageGuardMissing();
        } else if (_sequencer != address(0) || _grace != 0) {
            revert BadFeed();
        }
        asset = _asset;
        tokenDecimals = _tokenDecimals;
        assetUsd = IAggregatorV3(_assetUsd);
        ethUsd = IAggregatorV3(_ethUsd);
        assetFeedDecimals = assetUsd.decimals();
        ethFeedDecimals = ethUsd.decimals();
        if (assetFeedDecimals > 18 || ethFeedDecimals > 18) revert BadFeed();
        requireSequencer = _requireSequencer;
        sequencer = IAggregatorV3(_sequencer);
        sequencerGrace = _grace;
    }

    /// @inheritdoc IFundPriceFeed
    function latestPrice(address queried) external view returns (uint256 priceX18, uint64 updatedAt) {
        if (queried != asset) revert WrongAsset();
        if (requireSequencer) _sequencerUp();
        (int256 assetAnswer, uint256 assetAt) = _round(assetUsd);
        (int256 ethAnswer, uint256 ethAt) = _round(ethUsd);
        priceX18 = _ethPerRaw(assetAnswer, ethAnswer);
        uint256 older = assetAt < ethAt ? assetAt : ethAt;
        updatedAt = uint64(older);
    }

    function _round(IAggregatorV3 feed) internal view returns (int256 answer, uint256 updatedAt) {
        (uint80 roundId, int256 value,, uint256 updated, uint80 answeredInRound) = feed.latestRoundData();
        if (value <= 0 || updated == 0 || updated > block.timestamp || answeredInRound < roundId) {
            revert PriceUnavailable();
        }
        return (value, updated);
    }

    /// @dev ETH wei per 1e18 raw units. assetUSD/ETHUSD, then scaled into raw token units.
    function _ethPerRaw(int256 assetAnswer, int256 ethAnswer) internal view returns (uint256) {
        uint256 num = Math.mulDiv(
            uint256(assetAnswer), (10 ** uint256(ethFeedDecimals)) * 1e36, 10 ** uint256(assetFeedDecimals)
        );
        uint256 den = Math.mulDiv(uint256(ethAnswer), 10 ** uint256(tokenDecimals), 1);
        if (den == 0) revert PriceUnavailable();
        uint256 price = Math.mulDiv(num, 1, den);
        if (price == 0) revert PriceUnavailable();
        return price;
    }

    /// @dev Answer 0 means the sequencer is up. Answer 1 means it is down. A restart waits out `sequencerGrace`.
    function _sequencerUp() internal view {
        if (address(sequencer) == address(0)) revert OutageGuardMissing();
        (, int256 answer, uint256 startedAt,,) = sequencer.latestRoundData();
        if (startedAt == 0 || answer != 0) revert SequencerDown();
        if (block.timestamp < startedAt + sequencerGrace) revert SequencerGrace();
    }
}
