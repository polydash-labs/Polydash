// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {StrategyParams} from "./AgentTypes.sol";

/// @title AgentStrategies (not reviewed, not deployed)
/// @notice The six strategy templates an AI-agent fund can run, with risk-level guardrail
///         defaults. Pure defaults only: the caller fills in `rulesHash` (keccak of the
///         off-chain rules JSON) and may tighten any cap afterwards. The deviation cap is
///         always left 0, so the vault's own cap applies.
library AgentStrategies {
    uint8 internal constant TEMPLATE_COUNT = 6;

    uint8 internal constant MOMENTUM = 0;
    uint8 internal constant DIP_BUYER = 1;
    uint8 internal constant DEFENSIVE = 2;
    uint8 internal constant DCA = 3;
    uint8 internal constant BALANCED = 4;
    uint8 internal constant CUSTOM = 5;

    error InvalidTemplate();
    error InvalidRiskLevel();

    /// @notice Plain template name, e.g. "Momentum". Reverts for an unknown template id.
    function templateName(uint8 templateId) internal pure returns (string memory) {
        if (templateId == MOMENTUM) return "Momentum";
        if (templateId == DIP_BUYER) return "DipBuyer";
        if (templateId == DEFENSIVE) return "Defensive";
        if (templateId == DCA) return "Dca";
        if (templateId == BALANCED) return "Balanced";
        if (templateId == CUSTOM) return "Custom";
        revert InvalidTemplate();
    }

    /// @notice Guardrail defaults for a template + risk level. `rulesHash` is 0; the caller
    ///         fills it in. Conservative: 30% position / 20% trade / 5% breaker / 3 trades a
    ///         day. Balanced: 50% / 50% / 10% / 6 a day. Aggressive: 75% / 75% / 20% / 12 a day.
    ///         Rebalance interval: Momentum 4h, DipBuyer 1h, Defensive 24h, Dca 24h,
    ///         Balanced 12h, Custom 12h. Deviation cap left 0 (use the vault's).
    function defaults(uint8 templateId, uint8 riskLevel) internal pure returns (StrategyParams memory p) {
        if (templateId >= TEMPLATE_COUNT) revert InvalidTemplate();
        if (riskLevel > 2) revert InvalidRiskLevel();
        p.templateId = templateId;
        p.riskLevel = riskLevel;
        p.maxDeviationBps = 0;
        p.rulesHash = bytes32(0);
        if (riskLevel == 0) {
            p.maxPositionBps = 3000;
            p.maxTradeBps = 2000;
            p.circuitBreakerBps = 500;
            p.dailyTradeLimit = 3;
        } else if (riskLevel == 1) {
            p.maxPositionBps = 5000;
            p.maxTradeBps = 5000;
            p.circuitBreakerBps = 1000;
            p.dailyTradeLimit = 6;
        } else {
            p.maxPositionBps = 7500;
            p.maxTradeBps = 7500;
            p.circuitBreakerBps = 2000;
            p.dailyTradeLimit = 12;
        }
        if (templateId == MOMENTUM) p.rebalanceIntervalSeconds = 4 hours;
        else if (templateId == DIP_BUYER) p.rebalanceIntervalSeconds = 1 hours;
        else if (templateId == DEFENSIVE) p.rebalanceIntervalSeconds = 24 hours;
        else if (templateId == DCA) p.rebalanceIntervalSeconds = 24 hours;
        else if (templateId == BALANCED) p.rebalanceIntervalSeconds = 12 hours;
        else p.rebalanceIntervalSeconds = 12 hours;
    }
}
