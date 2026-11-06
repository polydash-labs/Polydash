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

    event Bound(address indexed nft);
    event Deposited(uint256 gross, uint256 principalAdded, uint256 entryFee, uint256 protocolFee);
    event RaiseClosed(uint256 raised, uint256 minted);
    event RaiseFailed(uint256 raised, uint256 minted);
    event Refunded(address indexed holder, uint256 count, uint256 ethOut);
    event Exited(address indexed holder, uint256 count, uint256 ethOut);
    event EntryFeeWithdrawn(address indexed to, uint256 amount);
    event ProtocolFeeWithdrawn(address indexed to, uint256 amount);
    event PayoutWalletSet(address indexed wallet);
    event InvestingEnabled(bytes32 indexed mandateHash, uint256 nav);
    event Trade(address indexed asset, uint8 side, uint256 size, uint256 price, uint256 navAfter);
    event ExecutorSet(address indexed executor, bool allowed);
    event SwapsPaused(bool paused);

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
