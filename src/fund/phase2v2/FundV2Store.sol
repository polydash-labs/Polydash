// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IFundAllowlistV2} from "./Interfaces.sol";

/// @notice Shared storage for `FundVaultV2` and `FundSwapFacetV2`. Delegatecall requires this order.
abstract contract FundV2Store {
    uint256 public constant BPS = 10_000;
    uint8 public constant BLOT_CAP = 32;
    uint8 public constant MAX_EXECUTORS = 8;
    uint8 public constant MAX_ASSETS = 16;
    uint8 public constant SIDE_BUY = 0;
    uint8 public constant SIDE_SELL = 1;
    uint256 public constant ORACLE_STALE = 1 hours;

    enum Status {
        Raising,
        Failed,
        RaisingClosed,
        Investing,
        WindingDown
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
    uint256 public mintPrice;
    uint256 public entryFeeBps;
    uint256 public protocolFeeBps;
    IFundAllowlistV2 public allowlist;
    address public weth;
    address public oracle;
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
    uint64 public raiseDeadline;

    mapping(address => uint256) public costBasis;
    mapping(address => bool) public inMandate;
    mapping(address => bool) public isExecutor;
    mapping(uint256 => TradeRecord) public trades;
    address[] internal _mandateAssets;

    event Bound(address indexed nft);
    event Deposited(uint256 gross, uint256 principalAdded, uint256 entryFee, uint256 protocolFee);
    event RaiseClosed(uint256 raised, uint256 minted);
    event RaiseFailed(uint256 raised, uint256 minted);
    event Refunded(address indexed holder, uint256 count, uint256 ethOut);
    event WindDownStarted(uint64 at);
    event Redeemed(address indexed holder, uint256 count, uint256 ethOut);
    event EntryFeeWithdrawn(address indexed to, uint256 amount);
    event ProtocolFeeWithdrawn(address indexed to, uint256 amount);
    event PayoutWalletSet(address indexed wallet);
    event InvestingEnabled(bytes32 indexed mandateHash, uint256 quoteNav);
    event OracleSet(address indexed oracle);
    event Trade(address indexed asset, uint8 side, uint256 size, uint256 price, uint256 navAfter);
    event ExecutorSet(address indexed executor, bool allowed);
    event SwapsPaused(bool paused);

    error NotFactory();
    error NotNft();
    error NotManager();
    error NotAuthorized();
    error NotRaising();
    error NotFailed();
    error NotClosed();
    error NotInvesting();
    error NotWinding();
    error RaiseOpen();
    error TargetMet();
    error AlreadyBound();
    error BadValue();
    error NothingToWithdraw();
    error FeesLocked();
    error TransferFailed();
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
}
