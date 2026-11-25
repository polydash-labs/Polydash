// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Strategy guardrails for one AI-agent-managed fund. A 0 cap means "use the vault's
///         cap"; a 0 daily limit means 5 trades per day; a 0 breaker means 1000 bps (10%);
///         a 0 rebalance interval means 3600 seconds (1 hour). See `AgentStrategies.defaults`.
struct StrategyParams {
    uint8 templateId; // 0 Momentum, 1 DipBuyer, 2 Defensive, 3 Dca, 4 Balanced, 5 Custom
    uint8 riskLevel; // 0 conservative, 1 balanced, 2 aggressive
    uint16 maxPositionBps; // 0 = use the vault's cap
    uint16 maxTradeBps; // 0 = use the vault's cap
    uint16 maxDeviationBps; // 0 = use the vault's cap
    uint16 dailyTradeLimit; // max executed instructions per UTC day; 0 = 5
    uint16 circuitBreakerBps; // NAV-per-NFT drawdown vs high-water that trips the breaker; 0 = 1000 (10%)
    uint32 rebalanceIntervalSeconds; // minimum seconds between executions; 0 = 3600 (1h)
    bytes32 rulesHash; // keccak of the off-chain rules JSON (the agent's constitution detail)
}

/// @notice One signed trade instruction. Anyone may submit it; the EIP-712 signature over
///         these exact fields, recovering the agent key, is the authorization.
struct Instruction {
    address vault;
    address router;
    address assetIn;
    address assetOut;
    uint256 amountIn;
    uint256 minAmountOut;
    bytes data;
    uint256 deadline;
    uint256 nonce;
}
