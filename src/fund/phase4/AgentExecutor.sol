// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundAllowlist} from "../phase2/Interfaces.sol";
import {Instruction, StrategyParams} from "./AgentTypes.sol";

/// @notice The vault surface the executor reads. `status()` is the vault's enum as a uint8:
///         0 Raising, 1 RaisingClosed, 2 Investing, 3 Failed.
interface IAgentVault {
    function manager() external view returns (address);
    function status() external view returns (uint8);
    function swapsPaused() external view returns (bool);
    function isExecutor(address) external view returns (bool);
    function inMandate(address) external view returns (bool);
    function allowlist() external view returns (IFundAllowlist);
    function weth() external view returns (address);
    function maxPositionBps() external view returns (uint256);
    function maxTradeBps() external view returns (uint256);
    function nav() external view returns (uint256);
    function navPerNft() external view returns (uint256);
    function swap(address router, address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external;
}

/// @title AgentExecutor (not reviewed, not deployed)
/// @notice Verifies signed AI-agent trade instructions, then forwards them to one fund vault
///         via the vault's existing executor path (`FundVaultInvest.setExecutor`).
///         The agent NEVER holds money: balances stay in the vault, and the vault's swap facet
///         re-enforces mandate, allowlist, position, trade, and deviation caps after this
///         contract's pre-checks, so a facet revert rolls the whole `execute` back.
///         Anyone may submit an instruction; the EIP-712 signature recovering the agent key is
///         the authorization. The human vault manager can pause swaps, pause/unpause/retire
///         this executor, revoke it as a vault executor, or rotate the agent key.
///         Router `data` is opaque calldata. Trust comes from the router allowlist, the amount
///         caps, and `minAmountOut` — not from inspecting `data`.
contract AgentExecutor is EIP712, ReentrancyGuard {
    uint8 internal constant VAULT_INVESTING = 2;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant DEFAULT_DAILY_LIMIT = 5;
    uint256 internal constant DEFAULT_CIRCUIT_BREAKER_BPS = 1000;
    uint256 internal constant DEFAULT_REBALANCE_INTERVAL = 3600;

    bytes32 internal constant INSTRUCTION_TYPEHASH = keccak256(
        "Instruction(address vault,address router,address assetIn,address assetOut,uint256 amountIn,uint256 minAmountOut,bytes data,uint256 deadline,uint256 nonce)"
    );

    /// @notice One failure per check, in the order `execute` runs them. `validate()` maps
    ///         these to the kebab-case reason strings the runner and front-end display.
    enum Check {
        Ok,
        WrongVault,
        Expired,
        BadNonce,
        BadSignature,
        Paused,
        NotInvesting,
        VaultPaused,
        NotExecutor,
        NotInMandate,
        NotAllowlisted,
        BadRouter,
        TradeCap,
        PositionCap,
        DailyLimit,
        CircuitBreaker,
        TooSoon
    }

    address public immutable vault;
    address public immutable registry;
    address public agentKey;
    StrategyParams public params;
    bool public paused;
    bool public retired;
    uint256 public nextNonce;
    uint256 public highWaterNavPerNft; // 0 means "not set yet"
    uint256 public lastExecution;
    mapping(uint256 => uint256) public tradesToday;

    event InstructionExecuted(
        address indexed vault,
        address indexed assetIn,
        address indexed assetOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 nonce,
        uint256 navPerNftAfter
    );
    event CircuitBreakerTripped(uint256 navPerNft, uint256 highWaterNavPerNft);
    event AgentPaused(address indexed by);
    event AgentUnpaused(address indexed by);
    event AgentKeyUpdated(address indexed oldKey, address indexed newKey);
    event AgentRetired(address indexed vault);

    error WrongVault();
    error Expired();
    error BadNonce();
    error BadSignature();
    error ExecutorPaused();
    error NotInvesting();
    error VaultPaused();
    error NotExecutor();
    error NotInMandate();
    error NotAllowlisted();
    error BadRouter();
    error TradeCap();
    error PositionCap();
    error DailyLimitExceeded();
    error BreakerTripped();
    error TooSoon();
    error NotManager();
    error NotAuthorized();
    error ZeroAddress();

    modifier onlyManager() {
        if (msg.sender != IAgentVault(vault).manager()) revert NotManager();
        _;
    }

    constructor(address vault_, address agentKey_, StrategyParams memory params_, address registry_)
        EIP712("PolypadAgentExecutor", "1")
    {
        if (vault_ == address(0) || agentKey_ == address(0)) revert ZeroAddress();
        vault = vault_;
        agentKey = agentKey_;
        params = params_;
        registry = registry_;
    }

    /// @notice The vault manager (the fund's human creator).
    function manager() external view returns (address) {
        return IAgentVault(vault).manager();
    }

    /// @notice Effective trade cap: the tighter of the strategy cap and the vault cap.
    ///         A strategy cap of 0 means "use the vault's cap".
    function effectiveTradeCapBps() public view returns (uint256) {
        uint256 vaultCap = IAgentVault(vault).maxTradeBps();
        if (params.maxTradeBps == 0) return vaultCap;
        return params.maxTradeBps < vaultCap ? params.maxTradeBps : vaultCap;
    }

    /// @notice Effective position cap: the tighter of the strategy cap and the vault cap.
    ///         A strategy cap of 0 means "use the vault's cap".
    function effectivePositionCapBps() public view returns (uint256) {
        uint256 vaultCap = IAgentVault(vault).maxPositionBps();
        if (params.maxPositionBps == 0) return vaultCap;
        return params.maxPositionBps < vaultCap ? params.maxPositionBps : vaultCap;
    }

    function effectiveDailyLimit() public view returns (uint16) {
        return params.dailyTradeLimit == 0 ? uint16(DEFAULT_DAILY_LIMIT) : params.dailyTradeLimit;
    }

    function effectiveCircuitBreakerBps() public view returns (uint16) {
        return params.circuitBreakerBps == 0 ? uint16(DEFAULT_CIRCUIT_BREAKER_BPS) : params.circuitBreakerBps;
    }

    function effectiveRebalanceInterval() public view returns (uint32) {
        return params.rebalanceIntervalSeconds == 0
            ? uint32(DEFAULT_REBALANCE_INTERVAL)
            : params.rebalanceIntervalSeconds;
    }

    /// @notice Execute one signed instruction. Reverts with a custom error on any failed check.
    ///         On a circuit-breaker trip the executor pauses itself and reverts, so the pause
    ///         must be confirmed on-chain (the revert rolls the pause back); the runner treats
    ///         the revert as "tripped" and the manager can also call `pause()` directly.
    function execute(Instruction calldata ix, bytes calldata signature) external nonReentrant {
        Check check = _check(ix, signature);
        if (check == Check.CircuitBreaker) {
            paused = true;
            emit CircuitBreakerTripped(IAgentVault(vault).navPerNft(), highWaterNavPerNft);
            revert BreakerTripped();
        }
        if (check != Check.Ok) _revert(check);

        IAgentVault v = IAgentVault(vault);
        uint256 day = block.timestamp / 1 days;
        uint256 current = v.navPerNft();
        nextNonce += 1;
        lastExecution = block.timestamp;
        tradesToday[day] += 1;
        if (current > highWaterNavPerNft) highWaterNavPerNft = current;
        v.swap(ix.router, ix.assetIn, ix.assetOut, ix.amountIn, ix.minAmountOut, ix.data);
        emit InstructionExecuted(
            vault, ix.assetIn, ix.assetOut, ix.amountIn, ix.minAmountOut, ix.nonce, v.navPerNft()
        );
    }

    /// @notice Dry-run of `execute`: same checks, no state changes. Returns
    ///         `(true, "ok")` when the instruction would execute, else `(false, reason)`
    ///         with a kebab-case reason: "wrong-vault", "expired", "bad-nonce",
    ///         "bad-signature", "paused", "not-investing", "vault-paused", "not-executor",
    ///         "not-in-mandate", "not-allowlisted", "bad-router", "trade-cap",
    ///         "position-cap", "daily-limit", "circuit-breaker", "too-soon".
    ///         A price that cannot be read fails closed as the cap it guards ("trade-cap"
    ///         for the trade value, "position-cap" for the position estimate).
    function validate(Instruction calldata ix, bytes calldata signature)
        external
        view
        returns (bool ok, string memory reason)
    {
        Check check = _check(ix, signature);
        if (check == Check.Ok) return (true, "ok");
        return (false, _reason(check));
    }

    /// @notice Pause trading. The vault manager or the agent key may pause; only the manager
    ///         may unpause (below), so a leaked agent key cannot resume a paused agent.
    function pause() external {
        if (msg.sender != agentKey && msg.sender != IAgentVault(vault).manager()) revert NotAuthorized();
        paused = true;
        emit AgentPaused(msg.sender);
    }

    /// @notice Resume trading. Manager only.
    function unpause() external onlyManager {
        paused = false;
        emit AgentUnpaused(msg.sender);
    }

    /// @notice Stop this executor for good. Manager only. Sets `retired` and `paused`.
    ///         The manager also calls `vault.setExecutor(executor, false)` and
    ///         `registry.retireAgent(agentId)` from the front-end.
    function retire() external onlyManager {
        retired = true;
        paused = true;
        emit AgentRetired(vault);
    }

    /// @notice Rotate the signing key, e.g. after a leak. Manager only.
    function updateAgentKey(address newKey) external onlyManager {
        if (newKey == address(0)) revert ZeroAddress();
        address oldKey = agentKey;
        agentKey = newKey;
        emit AgentKeyUpdated(oldKey, newKey);
    }

    /// @dev All checks, in order. Shared by `execute` and `validate` so they can never disagree.
    function _check(Instruction calldata ix, bytes calldata signature) internal view returns (Check) {
        if (ix.vault != vault) return Check.WrongVault;
        if (ix.deadline < block.timestamp) return Check.Expired;
        if (ix.nonce != nextNonce) return Check.BadNonce;
        if (_recover(ix, signature) != agentKey) return Check.BadSignature;
        if (paused || retired) return Check.Paused;

        IAgentVault v = IAgentVault(vault);
        if (v.status() != VAULT_INVESTING) return Check.NotInvesting;
        if (v.swapsPaused()) return Check.VaultPaused;
        if (!v.isExecutor(address(this))) return Check.NotExecutor;

        address weth = v.weth();
        if (!_inMandateOrQuote(v, weth, ix.assetIn) || !_inMandateOrQuote(v, weth, ix.assetOut)) {
            return Check.NotInMandate;
        }
        IFundAllowlist allowlist = v.allowlist();
        if (!_allowlisted(allowlist, weth, ix.assetIn) || !_allowlisted(allowlist, weth, ix.assetOut)) {
            return Check.NotAllowlisted;
        }
        if (ix.router != address(0) && !allowlist.routerAllowed(ix.router)) return Check.BadRouter;

        (bool navOk, uint256 nav) = _tryNav(v);
        if (!navOk) return Check.TradeCap;
        uint256 tradeValue;
        if (ix.assetIn == address(0) || ix.assetIn == weth) {
            tradeValue = ix.amountIn;
        } else {
            (bool quoteOk, uint256 quoted) = _tryQuote(allowlist, ix.assetIn, ix.amountIn);
            if (!quoteOk) return Check.TradeCap;
            tradeValue = quoted;
        }
        if (tradeValue * BPS > effectiveTradeCapBps() * nav) return Check.TradeCap;

        Check position = _positionCheck(v, allowlist, weth, ix, nav);
        if (position != Check.Ok) return position;

        if (tradesToday[block.timestamp / 1 days] >= effectiveDailyLimit()) return Check.DailyLimit;

        (bool perOk, uint256 current) = _tryNavPerNft(v);
        if (!perOk) return Check.CircuitBreaker;
        uint256 breakerBps = effectiveCircuitBreakerBps();
        if (highWaterNavPerNft > 0 && current < (highWaterNavPerNft * (BPS - breakerBps)) / BPS) {
            return Check.CircuitBreaker;
        }

        if (block.timestamp < lastExecution + effectiveRebalanceInterval()) return Check.TooSoon;
        return Check.Ok;
    }

    /// @dev Position-cap pre-check, conservative: the bought asset's post-trade balance is
    ///         estimated as its current balance plus `minAmountOut`, valued at the feed.
    ///         Sells only shrink a position, so they skip this. ETH/WETH wraps have no
    ///         position cap (the quote asset has no feed to value it at).
    function _positionCheck(IAgentVault v, IFundAllowlist allowlist, address weth, Instruction calldata ix, uint256 nav)
        internal
        view
        returns (Check)
    {
        bool buying = ix.assetIn == address(0) || ix.assetIn == weth;
        if (!buying) return Check.Ok;
        address bought = ix.assetOut;
        if (bought == address(0) || bought == weth) return Check.Ok;
        uint256 estimate = IERC20(bought).balanceOf(vault) + ix.minAmountOut;
        (bool ok, uint256 value) = _tryQuote(allowlist, bought, estimate);
        if (!ok) return Check.PositionCap;
        if (value * BPS > effectivePositionCapBps() * nav) return Check.PositionCap;
        return Check.Ok;
    }

    function _inMandateOrQuote(IAgentVault v, address weth, address asset) internal view returns (bool) {
        return asset == address(0) || asset == weth || v.inMandate(asset);
    }

    function _allowlisted(IFundAllowlist allowlist, address weth, address asset) internal view returns (bool) {
        if (asset == address(0) || asset == weth) return true;
        return allowlist.assetAllowed(asset);
    }

    function _tryNav(IAgentVault v) internal view returns (bool ok, uint256 value) {
        try v.nav() returns (uint256 n) {
            return (true, n);
        } catch {
            return (false, 0);
        }
    }

    function _tryNavPerNft(IAgentVault v) internal view returns (bool ok, uint256 value) {
        try v.navPerNft() returns (uint256 n) {
            return (true, n);
        } catch {
            return (false, 0);
        }
    }

    function _tryQuote(IFundAllowlist allowlist, address asset, uint256 amount)
        internal
        view
        returns (bool ok, uint256 value)
    {
        try allowlist.quote(asset, amount) returns (uint256 q) {
            return (true, q);
        } catch {
            return (false, 0);
        }
    }

    function _recover(Instruction calldata ix, bytes calldata signature) internal view returns (address) {
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
        return ECDSA.recover(_hashTypedDataV4(structHash), signature);
    }

    function _revert(Check check) internal pure {
        if (check == Check.WrongVault) revert WrongVault();
        if (check == Check.Expired) revert Expired();
        if (check == Check.BadNonce) revert BadNonce();
        if (check == Check.BadSignature) revert BadSignature();
        if (check == Check.Paused) revert ExecutorPaused();
        if (check == Check.NotInvesting) revert NotInvesting();
        if (check == Check.VaultPaused) revert VaultPaused();
        if (check == Check.NotExecutor) revert NotExecutor();
        if (check == Check.NotInMandate) revert NotInMandate();
        if (check == Check.NotAllowlisted) revert NotAllowlisted();
        if (check == Check.BadRouter) revert BadRouter();
        if (check == Check.TradeCap) revert TradeCap();
        if (check == Check.PositionCap) revert PositionCap();
        if (check == Check.DailyLimit) revert DailyLimitExceeded();
        if (check == Check.TooSoon) revert TooSoon();
        revert BreakerTripped();
    }

    function _reason(Check check) internal pure returns (string memory) {
        if (check == Check.WrongVault) return "wrong-vault";
        if (check == Check.Expired) return "expired";
        if (check == Check.BadNonce) return "bad-nonce";
        if (check == Check.BadSignature) return "bad-signature";
        if (check == Check.Paused) return "paused";
        if (check == Check.NotInvesting) return "not-investing";
        if (check == Check.VaultPaused) return "vault-paused";
        if (check == Check.NotExecutor) return "not-executor";
        if (check == Check.NotInMandate) return "not-in-mandate";
        if (check == Check.NotAllowlisted) return "not-allowlisted";
        if (check == Check.BadRouter) return "bad-router";
        if (check == Check.TradeCap) return "trade-cap";
        if (check == Check.PositionCap) return "position-cap";
        if (check == Check.DailyLimit) return "daily-limit";
        if (check == Check.CircuitBreaker) return "circuit-breaker";
        return "too-soon";
    }
}
