// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IFundAllowlist} from "./Interfaces.sol";

/// @notice Shared storage for `FundVaultInvest` and `FundSwapFacet`.
///         The facet runs by delegatecall, so this layout has to stay in the same order in both.
abstract contract FundVaultStore {
    uint256 public constant BPS = 10_000;
    uint8 public constant BLOT_CAP = 32;
    uint8 public constant MAX_EXECUTORS = 8;
    uint8 public constant MAX_ASSETS = 16;
    uint8 public constant SIDE_BUY = 0;
    uint8 public constant SIDE_SELL = 1;

    uint8 public constant BIT_CUSTODY = 1;
    uint8 public constant BIT_ALLOWLIST = 2;
    uint8 public constant BIT_HWM = 4;
    uint8 public constant BIT_SKIN = 8;
    uint8 public constant BIT_SOURCE = 16;
    uint8 public constant BIT_TIMELOCK = 32;
    uint8 public constant PROTECTION_TOTAL = 6;

    /// @notice Defaults used when a fund is created with a 0 cap. 7500 = at most 75% of NAV in one
    ///         asset or in one trade, 5000 = execution within 50% of the feed. The 75% defaults are
    ///         deliberately above 50%: NAV excludes unclaimed fees, so a trade that is exactly half
    ///         of the gross balance is slightly over half of net NAV.
    uint256 public constant DEFAULT_MAX_POSITION_BPS = 7500;
    uint256 public constant DEFAULT_MAX_TRADE_BPS = 7500;
    uint256 public constant DEFAULT_MAX_DEVIATION_BPS = 5000;
    /// @notice Minimum time between permissionless NAV checkpoints.
    uint256 public constant NAV_CHECKPOINT_INTERVAL = 1 hours;

    enum Status {
        Raising,
        RaisingClosed,
        Investing,
        Failed
    }

    struct TradeRecord {
        address asset;
        uint8 side;
        uint64 timestamp;
        uint256 size;
        uint256 price;
        uint256 navAfter;
    }

    address public factory;
    address public manager;
    uint256 public raiseCap;
    uint256 public maxSupply;
    uint256 public entryFeeBps;
    uint256 public protocolFeeBps;
    IFundAllowlist public allowlist;
    address public weth;
    bytes32 public mandateHash;
    bytes32 public universeHash;

    address public nft;
    address public payoutWallet;
    Status public status;
    bool public swapsPaused;
    bool internal inSwap;

    uint256 public raised;
    uint256 public principal;
    uint256 public entryFeeAccrued;
    uint256 public entryFeeClaimed;
    uint256 public protocolFeeAccrued;
    uint256 public protocolFeeClaimed;
    uint256 public totalCostBasis;
    uint256 public tradeCount;
    uint256 public executorCount;
    uint64 public investBlock;
    uint64 public investTimestamp;
    uint64 public raiseDeadline;

    mapping(address => uint256) public costBasis;
    mapping(address => bool) public inMandate;
    mapping(address => bool) public isExecutor;
    mapping(uint256 => TradeRecord) public trades;
    address[] internal _mandateAssets;
    /// @dev Tokens kept for a holder when a transfer did not complete. Later exits skip this amount.
    mapping(address => mapping(address => uint256)) public tokenOwed;
    mapping(address => uint256) public tokenReserved;

    /// @dev Appended after the PR 24 layout. Keep new storage at the end so the vault/facet layout
    ///      stays in lockstep. Phase 2 is not deployed, so there is no live storage to migrate.
    /// @dev Per-fund swap policy, in BPS of NAV. Set once at creation; there is no setter, so the
    ///      manager cannot loosen them later. 0 at creation means "use the default" (handled in the vault).
    uint256 public maxPositionBps;
    uint256 public maxTradeBps;
    uint256 public maxDeviationBps;
    /// @dev Last hourly NAV checkpoint. 0 until the first `checkpointNav()` call.
    uint64 public lastNavCheckpoint;
    uint256 public lastCheckpointNavPerNft;

    event Bound(address indexed nft);
    event Deposited(uint256 gross, uint256 principalAdded, uint256 entryFee, uint256 protocolFee);
    event RaiseClosed(uint256 raised, uint256 minted);
    event RaiseFailed(uint256 raised, uint256 minted);
    event Refunded(address indexed holder, uint256 count, uint256 ethOut);
    event Exited(address indexed holder, uint256 count, uint256 ethOut);
    event TokenOwed(address indexed holder, address indexed asset, uint256 amount);
    event TokenClaimed(address indexed holder, address indexed asset, uint256 amount);
    event EntryFeeWithdrawn(address indexed to, uint256 amount);
    event ProtocolFeeWithdrawn(address indexed to, uint256 amount);
    event PayoutWalletSet(address indexed wallet);
    event InvestingEnabled(bytes32 indexed mandateHash, uint256 nav);
    event Trade(address indexed asset, uint8 side, uint256 size, uint256 price, uint256 navAfter);
    event ExecutorSet(address indexed executor, bool allowed);
    event SwapsPaused(bool paused);
    /// @notice Emitted once, at fund creation, with the mandate text location. The hash alone does not
    ///         let LPs read the mandate; the URI must point at the same text the hash was taken from.
    event MandatePublished(bytes32 indexed mandateHash, string mandateUri);
    event PositionCapsSet(uint256 maxPositionBps, uint256 maxTradeBps, uint256 maxDeviationBps);
    event NavCheckpoint(uint64 indexed timestamp, uint256 nav, uint256 navPerNft);

    error NotFactory();
    error NotNft();
    error NotManager();
    error NotAuthorized();
    error NotRaising();
    error NotClosed();
    error NotInvesting();
    error NotFailed();
    error NotExitable();
    error RaiseEnded();
    error TooEarly();
    error AlreadyBound();
    error BadValue();
    error NothingToWithdraw();
    error TransferFailed();
    /// @notice A token moved, but the holder did not receive the full amount. Fee-on-transfer is not supported.
    error UnsupportedToken();
    error ZeroAddress();
    error DirectTransfer();
    error SkinRequired();
    error Paused();
    error NotAllowlisted();
    error NotInMandate();
    error BadPair();
    error BadAmount();
    error BadRouter();
    error Slippage();
    error SwapFailed();
    error FeesShort();
    error BadIndex();
    error TooMany();
    error BadExecutor();
    error DirectFacetCall();
    error PositionCap();
    error TradeCap();
    error Deviation();
    error TooSoon();
    error BadUri();
}
