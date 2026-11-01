// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {
    ITLaunch,
    ITLaunchQuote,
    TFees,
    TPoolKey,
    TSwapParams,
    ITPoolManager,
    ITUnlockCallback,
    ITStakingFactoryV2,
    ITStakingPoolV2
} from "./ITreasuryExternal.sol";

/// @title TreasuryRules (DRAFT - not deployed, not audited)
/// @notice Creator-owned, non-custodial treasury with a fixed menu of actions:
///         1. buyback: ETH -> launch token (bonding curve before graduation, the Polydash Uniswap V4 pool after),
///            within a daily ETH cap, a per-buyback cap, a minimum interval, a slippage limit and an optional
///            minimum tokens-per-ETH floor. Bought tokens are burned (sent to 0x...dEaD) or kept for rewards.
///         2. createRewardPool: funds a NEW PolydashStakingPoolV2 (stake = reward = token) from the vault's
///            tokens. V2 pools cannot be topped up, so periodic rewards are follow-on pools owned by this vault.
///         3. airdrop: a creator-approved merkle root, capped per round, claimable by holders.
///         Executors (creator-approved agents, or anyone if openExecution) can only trigger these actions and
///         never receive funds. The creator can pause instantly. Withdrawals, rule changes, new executors,
///         delay changes and airdrop rounds go through a public timelock (default 48h).
contract TreasuryRules is ReentrancyGuard, EIP712, ITUnlockCallback {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint64 public constant DEFAULT_DELAY = 48 hours;
    uint64 public constant MIN_DELAY = 24 hours;
    uint64 public constant MAX_DELAY = 30 days;
    uint256 public constant MAX_SLIPPAGE_BPS = 3_000;
    uint256 public constant MAX_EXECUTORS = 20;
    uint256 public constant MIN_CLAIM_WINDOW = 1 days;
    uint256 public constant MAX_CLAIM_WINDOW = 365 days;
    uint160 internal constant MIN_SQRT_PRICE_PLUS_ONE = 4295128740;
    int24 internal constant TICK_SPACING = 200;
    bytes32 internal constant POOLS_SLOT = bytes32(uint256(6));
    bytes32 public constant AIRDROP_TYPEHASH =
        keccak256("Airdrop(bytes32 root,uint256 total,uint64 claimWindow,uint256 nonce,uint256 deadline)");

    struct Rules {
        uint128 maxEthPerDay; // UTC-day cap on ETH spent by buybacks
        uint128 maxEthPerBuyback; // per-call cap
        uint32 minInterval; // seconds between buybacks
        uint16 maxSlippageBps; // vs the in-tx quote (curve) or spot price (V4); includes the pool fee
        bool burnBought; // true: send bought tokens to DEAD; false: keep in the vault for rewards/airdrops
        bool openExecution; // true: anyone may trigger actions; false: approved executors only
        uint256 minTokensPerEth; // 0 = off; tokens (wei) per 1e18 wei ETH the buyback must at least get
        uint256 maxAirdropPerRound; // token cap per airdrop round (0 = airdrops off)
        uint256 maxPoolReward; // token cap per follow-on reward pool (0 = off)
        uint32 poolMinInterval; // seconds between reward pools
        uint32 poolDuration; // reward pool duration (1 day .. 3650 days)
        uint16 poolClaimFeeBps; // 100..500, required by the staking factory
        uint256 poolMaxTotalStake; // 0 = uncapped
    }

    enum Kind {
        SetRules,
        Withdraw,
        AddExecutor,
        SetDelay,
        Airdrop
    }

    struct Change {
        Kind kind;
        uint64 eta;
        bool done; // executed or cancelled
        bytes data;
    }

    struct Round {
        bytes32 root;
        uint256 total;
        uint256 claimed;
        uint64 deadline;
        bool closed;
    }

    /// @dev Set once in initialize (EIP-1167 clone per token; the implementation itself is locked).
    address public factory;
    address public owner;
    address public token;
    address public launch;
    address public stakingFactory;
    address public poolManager;

    Rules internal _rules;
    uint64 public timelockDelay;
    bool public paused;

    mapping(address => bool) public isExecutor;
    address[] internal _executors;

    uint256 public currentDay;
    uint256 public spentToday;
    uint64 public lastBuybackAt;
    uint64 public lastPoolAt;

    uint256 public totalEthSpent;
    uint256 public totalTokensBought;
    uint256 public totalTokensBurned;

    uint256 public reservedTokens; // locked for open airdrop rounds
    uint256 public airdropNonce;

    Change[] internal _changes;
    Round[] internal _rounds;
    mapping(uint256 => mapping(address => bool)) public claimed;
    address[] internal _pools;
    mapping(address => bool) public isOwnPool;

    event Deposited(address indexed from, address indexed asset, uint256 amount);
    event Paused(bool paused);
    event ChangeQueued(uint256 indexed id, Kind indexed kind, uint64 eta, bytes data);
    event ChangeExecuted(uint256 indexed id, Kind indexed kind);
    event ChangeCancelled(uint256 indexed id, Kind indexed kind);
    event RulesUpdated(Rules rules);
    event ExecutorAdded(address indexed executor);
    event ExecutorRemoved(address indexed executor);
    event DelayUpdated(uint64 delay);
    event Withdrawn(address indexed asset, address indexed to, uint256 amount);
    event BuybackExecuted(
        address indexed executor, uint256 ethSpent, uint256 tokensOut, bool burned, bool viaPool
    );
    event RewardPoolCreated(address indexed executor, address indexed pool, uint256 amount, uint256 duration);
    event AirdropStarted(uint256 indexed round, bytes32 root, uint256 total, uint64 deadline);
    event AirdropClaimed(uint256 indexed round, address indexed account, uint256 amount);
    event AirdropClosed(uint256 indexed round, uint256 released);

    error NotOwner();
    error NotExecutor();
    error NotPoolManager();
    error IsPaused();
    error InvalidRules(string field);
    error InvalidParam();
    error TooEarly();
    error AlreadyDone();
    error DailyCap();
    error PerCallCap();
    error Interval();
    error Slippage();
    error PriceFloor();
    error Insufficient();
    error BadProof();
    error AlreadyClaimed();
    error RoundEnded();
    error RoundOpen();
    error BadSignature();
    error Expired();
    error EthSendFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyExecutor() {
        if (!_rules.openExecution && !isExecutor[msg.sender]) revert NotExecutor();
        if (paused) revert IsPaused();
        _;
    }

    error AlreadyInitialized();

    constructor() EIP712("Polydash TreasuryRules", "1") {
        factory = address(1); // lock the implementation
    }

    function initialize(
        address _owner,
        address _token,
        address _launch,
        address _stakingFactory,
        address _poolManager,
        Rules memory rules_,
        address[] memory executors_,
        uint64 delay_
    ) external payable {
        if (factory != address(0)) revert AlreadyInitialized();
        factory = msg.sender;
        owner = _owner;
        token = _token;
        launch = _launch;
        stakingFactory = _stakingFactory;
        poolManager = _poolManager;
        _setRules(rules_);
        uint64 d = delay_ == 0 ? DEFAULT_DELAY : delay_;
        if (d < MIN_DELAY || d > MAX_DELAY) revert InvalidParam();
        timelockDelay = d;
        emit DelayUpdated(d);
        if (executors_.length > MAX_EXECUTORS) revert InvalidParam();
        for (uint256 i; i < executors_.length; ++i) _addExecutor(executors_[i]);
        if (msg.value > 0) emit Deposited(_owner, address(0), msg.value);
    }

    receive() external payable {
        // refunds from the launch contract / pool manager are not deposits
        if (msg.sender != launch && msg.sender != poolManager) emit Deposited(msg.sender, address(0), msg.value);
    }

    // ------------------------------------------------------------------ views

    function rules() external view returns (Rules memory) {
        return _rules;
    }

    function executors() external view returns (address[] memory) {
        return _executors;
    }

    function changesCount() external view returns (uint256) {
        return _changes.length;
    }

    function getChange(uint256 id) external view returns (Change memory) {
        return _changes[id];
    }

    function roundsCount() external view returns (uint256) {
        return _rounds.length;
    }

    function getRound(uint256 id) external view returns (Round memory) {
        return _rounds[id];
    }

    function pools() external view returns (address[] memory) {
        return _pools;
    }

    function availableTokens() public view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        return bal > reservedTokens ? bal - reservedTokens : 0;
    }

    /// @notice ETH the buyback may still spend today (UTC day), ignoring balance.
    function remainingToday() public view returns (uint256) {
        uint256 spent = block.timestamp / 1 days == currentDay ? spentToday : 0;
        return _rules.maxEthPerDay > spent ? _rules.maxEthPerDay - spent : 0;
    }

    function nextBuybackAt() external view returns (uint256) {
        return lastBuybackAt == 0 ? 0 : uint256(lastBuybackAt) + _rules.minInterval;
    }

    function poolKey() public view returns (TPoolKey memory) {
        return TPoolKey(address(0), token, 0, TICK_SPACING, ITLaunch(launch).hook());
    }

    function spotSqrtPriceX96() public view returns (uint160) {
        bytes32 id = keccak256(abi.encode(poolKey()));
        return uint160(uint256(ITPoolManager(poolManager).extsload(keccak256(abi.encodePacked(id, POOLS_SLOT)))));
    }

    function airdropDigest(bytes32 root, uint256 total, uint64 claimWindow, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(AIRDROP_TYPEHASH, root, total, claimWindow, nonce, deadline)));
    }

    // ------------------------------------------------------------------ owner: instant

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice Removing an executor only reduces access, so it is instant.
    function removeExecutor(address e) external onlyOwner {
        if (!isExecutor[e]) revert InvalidParam();
        isExecutor[e] = false;
        uint256 n = _executors.length;
        for (uint256 i; i < n; ++i) {
            if (_executors[i] == e) {
                _executors[i] = _executors[n - 1];
                _executors.pop();
                break;
            }
        }
        emit ExecutorRemoved(e);
    }

    function depositToken(uint256 amount) external nonReentrant {
        uint256 b = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, token, IERC20(token).balanceOf(address(this)) - b);
    }

    // ------------------------------------------------------------------ owner: timelocked

    function queueRules(Rules calldata r) external onlyOwner returns (uint256) {
        _validate(r);
        return _queue(Kind.SetRules, abi.encode(r));
    }

    /// @param asset address(0) for ETH, or the vault token
    function queueWithdraw(address asset, uint256 amount, address to) external onlyOwner returns (uint256) {
        if ((asset != address(0) && asset != token) || amount == 0 || to == address(0)) revert InvalidParam();
        return _queue(Kind.Withdraw, abi.encode(asset, amount, to));
    }

    function queueAddExecutor(address e) external onlyOwner returns (uint256) {
        if (e == address(0)) revert InvalidParam();
        return _queue(Kind.AddExecutor, abi.encode(e));
    }

    function queueDelay(uint64 d) external onlyOwner returns (uint256) {
        if (d < MIN_DELAY || d > MAX_DELAY) revert InvalidParam();
        return _queue(Kind.SetDelay, abi.encode(d));
    }

    function queueAirdrop(bytes32 root, uint256 total, uint64 claimWindow) external onlyOwner returns (uint256) {
        _checkAirdrop(root, total, claimWindow);
        return _queue(Kind.Airdrop, abi.encode(root, total, claimWindow));
    }

    /// @notice An executor (e.g. an agent that built the holder list) submits a root the creator signed (EIP-712).
    function queueAirdropWithSig(bytes32 root, uint256 total, uint64 claimWindow, uint256 deadline, bytes calldata sig)
        external
        onlyExecutor
        returns (uint256)
    {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = airdropDigest(root, total, claimWindow, airdropNonce, deadline);
        if (ECDSA.recover(digest, sig) != owner) revert BadSignature();
        ++airdropNonce;
        _checkAirdrop(root, total, claimWindow);
        return _queue(Kind.Airdrop, abi.encode(root, total, claimWindow));
    }

    function cancel(uint256 id) external onlyOwner {
        Change storage c = _changes[id];
        if (c.done) revert AlreadyDone();
        c.done = true;
        emit ChangeCancelled(id, c.kind);
    }

    /// @notice Anyone can finalize a queued change once its timelock has passed.
    function execute(uint256 id) external nonReentrant {
        Change storage c = _changes[id];
        if (c.done) revert AlreadyDone();
        if (block.timestamp < c.eta) revert TooEarly();
        c.done = true;
        Kind k = c.kind;
        if (k == Kind.SetRules) {
            _setRules(abi.decode(c.data, (Rules)));
        } else if (k == Kind.Withdraw) {
            (address asset, uint256 amount, address to) = abi.decode(c.data, (address, uint256, address));
            if (asset == address(0)) {
                if (amount > address(this).balance) revert Insufficient();
                (bool ok,) = to.call{value: amount}("");
                if (!ok) revert EthSendFailed();
            } else {
                if (amount > availableTokens()) revert Insufficient();
                IERC20(token).safeTransfer(to, amount);
            }
            emit Withdrawn(asset, to, amount);
        } else if (k == Kind.AddExecutor) {
            address e = abi.decode(c.data, (address));
            if (!isExecutor[e]) {
                if (_executors.length >= MAX_EXECUTORS) revert InvalidParam();
                _addExecutor(e);
            }
        } else if (k == Kind.SetDelay) {
            timelockDelay = abi.decode(c.data, (uint64));
            emit DelayUpdated(timelockDelay);
        } else {
            (bytes32 root, uint256 total, uint64 window) = abi.decode(c.data, (bytes32, uint256, uint64));
            if (total > _rules.maxAirdropPerRound) revert PerCallCap();
            if (total > availableTokens()) revert Insufficient();
            reservedTokens += total;
            uint64 deadline = uint64(block.timestamp) + window;
            _rounds.push(Round(root, total, 0, deadline, false));
            emit AirdropStarted(_rounds.length - 1, root, total, deadline);
        }
        emit ChangeExecuted(id, k);
    }

    // ------------------------------------------------------------------ executor actions

    /// @param ethIn ETH to spend (capped by the rules)
    /// @param minOut executor's own minimum; the vault also enforces its slippage limit and price floor
    function buyback(uint256 ethIn, uint256 minOut) external onlyExecutor nonReentrant returns (uint256 tokensOut) {
        Rules memory r = _rules;
        if (ethIn == 0 || ethIn > address(this).balance) revert Insufficient();
        if (ethIn > r.maxEthPerBuyback) revert PerCallCap();
        uint256 day = block.timestamp / 1 days;
        if (day != currentDay) {
            currentDay = day;
            spentToday = 0;
        }
        if (spentToday + ethIn > r.maxEthPerDay) revert DailyCap();
        if (lastBuybackAt != 0 && block.timestamp < uint256(lastBuybackAt) + r.minInterval) revert Interval();

        uint256 ethBefore = address(this).balance;
        uint256 tokBefore = IERC20(token).balanceOf(address(this));
        bool viaPool = ITLaunch(launch).graduated();
        uint256 expected;
        if (viaPool) {
            uint256 sp = spotSqrtPriceX96();
            if (sp == 0) revert InvalidParam();
            expected = Math.mulDiv(Math.mulDiv(ethIn, sp, 1 << 96), sp, 1 << 96);
            ITPoolManager(poolManager).unlock(abi.encode(ethIn));
        } else {
            (expected,) = ITLaunchQuote(launch).quoteBuy(ethIn);
            // vault minimum is checked below, scaled to the ETH actually used (graduation can refund part)
            ITLaunch(launch).buy{value: ethIn}(minOut);
        }
        uint256 spent = ethBefore - address(this).balance;
        tokensOut = IERC20(token).balanceOf(address(this)) - tokBefore;
        if (spent == 0 || tokensOut == 0) revert Slippage();
        // slippage vs pre-trade price, scaled to what was actually spent (partial fills / graduation refunds)
        uint256 vaultMin = (Math.mulDiv(expected, spent, ethIn) * (10_000 - r.maxSlippageBps)) / 10_000;
        if (tokensOut < minOut || tokensOut < vaultMin) revert Slippage();
        if (r.minTokensPerEth != 0 && Math.mulDiv(tokensOut, 1e18, spent) < r.minTokensPerEth) revert PriceFloor();

        spentToday += spent;
        lastBuybackAt = uint64(block.timestamp);
        totalEthSpent += spent;
        totalTokensBought += tokensOut;
        if (r.burnBought) {
            totalTokensBurned += tokensOut;
            IERC20(token).safeTransfer(DEAD, tokensOut);
        }
        emit BuybackExecuted(msg.sender, spent, tokensOut, r.burnBought, viaPool);
    }

    /// @dev Uniswap V4 flash-accounting callback: exact-in ETH -> token swap, proceeds stay in this vault.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != poolManager) revert NotPoolManager();
        uint256 ethIn = abi.decode(data, (uint256));
        int256 delta = ITPoolManager(poolManager).swap(
            poolKey(), TSwapParams(true, -int256(ethIn), MIN_SQRT_PRICE_PLUS_ONE), ""
        );
        int128 a0 = int128(delta >> 128);
        int128 a1 = int128(delta);
        if (a0 > 0 || a1 < 0) revert Slippage();
        uint256 pay = uint256(uint128(-a0));
        if (pay > 0) ITPoolManager(poolManager).settle{value: pay}();
        if (a1 > 0) ITPoolManager(poolManager).take(token, address(this), uint256(uint128(a1)));
        return "";
    }

    /// @notice Fund a new PolydashStakingPoolV2 (stake = reward = token) from vault tokens. This vault is the
    ///         pool's creator, so pool creator fees and unallocated rewards come back here.
    function createRewardPool(uint256 amount) external onlyExecutor nonReentrant returns (address pool) {
        Rules memory r = _rules;
        if (amount == 0 || amount > r.maxPoolReward) revert PerCallCap();
        if (amount > availableTokens()) revert Insufficient();
        if (lastPoolAt != 0 && block.timestamp < uint256(lastPoolAt) + r.poolMinInterval) revert Interval();
        lastPoolAt = uint64(block.timestamp);
        IERC20(token).forceApprove(stakingFactory, amount);
        pool = ITStakingFactoryV2(stakingFactory).createPool(
            token,
            token,
            amount,
            0,
            r.poolDuration,
            r.poolMaxTotalStake,
            r.poolClaimFeeBps,
            "Treasury rewards",
            "Funded by this token's on-chain Treasury rules."
        );
        IERC20(token).forceApprove(stakingFactory, 0);
        _pools.push(pool);
        isOwnPool[pool] = true;
        emit RewardPoolCreated(msg.sender, pool, amount, r.poolDuration);
    }

    /// @notice Pull pool creator fees / unallocated rewards back into this vault. Anyone can call.
    function collectFromPool(address pool, bool unallocated) external nonReentrant {
        if (!isOwnPool[pool]) revert InvalidParam();
        if (unallocated) ITStakingPoolV2(pool).recoverUnallocated();
        else ITStakingPoolV2(pool).collectCreatorFees();
    }

    // ------------------------------------------------------------------ airdrop claims (not paused-gated)

    /// @dev leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount)))) (OpenZeppelin StandardMerkleTree)
    function claim(uint256 round, address account, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        Round storage rd = _rounds[round];
        if (rd.closed || block.timestamp > rd.deadline) revert RoundEnded();
        if (claimed[round][account]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verifyCalldata(proof, rd.root, leaf)) revert BadProof();
        if (rd.claimed + amount > rd.total) revert Insufficient();
        claimed[round][account] = true;
        rd.claimed += amount;
        reservedTokens -= amount;
        IERC20(token).safeTransfer(account, amount);
        emit AirdropClaimed(round, account, amount);
    }

    /// @notice After the claim window, release unclaimed tokens back to the vault budget. Anyone can call.
    function closeRound(uint256 round) external {
        Round storage rd = _rounds[round];
        if (rd.closed) revert AlreadyDone();
        if (block.timestamp <= rd.deadline) revert RoundOpen();
        rd.closed = true;
        uint256 rel = rd.total - rd.claimed;
        reservedTokens -= rel;
        emit AirdropClosed(round, rel);
    }

    // ------------------------------------------------------------------ internal

    function _queue(Kind k, bytes memory data) internal returns (uint256 id) {
        uint64 eta = uint64(block.timestamp) + timelockDelay;
        _changes.push(Change(k, eta, false, data));
        id = _changes.length - 1;
        emit ChangeQueued(id, k, eta, data);
    }

    function _addExecutor(address e) internal {
        if (e == address(0) || isExecutor[e]) revert InvalidParam();
        isExecutor[e] = true;
        _executors.push(e);
        emit ExecutorAdded(e);
    }

    function _checkAirdrop(bytes32 root, uint256 total, uint64 window) internal pure {
        if (root == bytes32(0) || total == 0 || window < MIN_CLAIM_WINDOW || window > MAX_CLAIM_WINDOW) {
            revert InvalidParam();
        }
    }

    function _setRules(Rules memory r) internal {
        _validate(r);
        _rules = r;
        emit RulesUpdated(r);
    }

    function _validate(Rules memory r) internal pure {
        if (r.maxEthPerBuyback > r.maxEthPerDay) revert InvalidRules("maxEthPerBuyback");
        if (r.maxEthPerDay > 0 && (r.maxSlippageBps == 0 || r.maxSlippageBps > MAX_SLIPPAGE_BPS)) {
            revert InvalidRules("maxSlippageBps");
        }
        if (r.minInterval > 30 days) revert InvalidRules("minInterval");
        if (r.maxPoolReward > 0) {
            if (r.poolDuration < 1 days || r.poolDuration > 3650 days) revert InvalidRules("poolDuration");
            if (r.poolClaimFeeBps < 100 || r.poolClaimFeeBps > 500) revert InvalidRules("poolClaimFeeBps");
            if (r.poolMinInterval > 365 days) revert InvalidRules("poolMinInterval");
        }
    }
}
