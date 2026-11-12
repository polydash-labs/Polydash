// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IPolydashStakingFactoryV2 {
    function feeRecipient() external view returns (address);
}

/// @title PolydashStakingPoolV2
/// @notice Single staking pool created by PolydashStakingFactoryV2.
///         - Rewards stream linearly from startTime to endTime, shared pro-rata by stake.
///         - Reward accounting is lossless: a 1e36-scaled accumulator, the division remainder is
///           carried between updates, and per-user rewards are kept in scaled units, so frequent
///           updates (anyone calling claim) can never round rewards away.
///         - Principal is never charged a fee. A claim fee (1-5%, chosen by the creator) is taken
///           from every reward payout, in the reward token: 30% to the platform, 70% to the creator.
///           Fees are accrued in the pool and collected separately (pull pattern), so a fee
///           recipient that rejects transfers can never block withdrawals or claims.
///         - Principal and rewards are tracked separately; reward payouts can never consume
///           principal, and if the pool ever holds less than it owes (negative rebase / transfer
///           fees) losses are shared pro-rata instead of first-come-first-served.
///         - Reward payouts are sized for the reward token's sender-side fee (learned from
///           observed outflows), and partial claims are always available, so a fee-on-transfer
///           reward token can never freeze unclaimed rewards.
contract PolydashStakingPoolV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant ACC = 1e36; // accumulator / scaled-reward precision
    uint256 private constant RATE = 1e18; // rewardRate precision
    uint256 public constant BPS = 10_000;
    uint256 public constant PLATFORM_SHARE_BPS = 3_000; // 30% of the claim fee

    address public immutable factory;
    address public immutable creator;
    IERC20 public immutable stakeToken;
    IERC20 public immutable rewardToken;
    bool public immutable sameToken;
    uint256 public immutable startTime;
    uint256 public immutable endTime;
    uint256 public immutable maxTotalStake; // 0 = unlimited
    uint256 public immutable claimFeeBps; // 100..500

    string public name;
    string public description;

    bool public funded;
    uint256 public totalRewards; // reward tokens actually received
    uint256 public rewardRate; // reward tokens per second * RATE
    uint256 public rewardReserve; // reward tokens still held for rewards + accrued fees + unallocated

    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored; // reward * ACC per staked unit
    uint256 public rewardRemainder; // reward * ACC, carried division remainder
    uint256 public unallocatedScaled; // reward * ACC, returned to the creator after the end

    uint256 public totalStaked; // staking shares (1:1 with tokens while the pool is solvent)
    uint256 public stakerCount;
    uint256 public totalRewardsPaid; // gross rewards settled to users (net payout + fees)
    uint256 public platformFeesAccrued;
    uint256 public creatorFeesAccrued;
    /// @notice Learned sender-side transfer fee of the stake token (bps). For tokens that take an
    ///         extra fee from the sender, withdrawals send less so the withdrawer bears their own fee.
    uint256 public stakeOutFeeBps;
    /// @notice Learned sender-side transfer fee of the reward token (bps). For tokens that take an
    ///         extra fee from the sender, claims are sized so the real outflow (net + fee) fits
    ///         the reward room left; without it a claim near the room would revert and, since
    ///         claim() takes no amount, the rewards would be frozen. Learned from observed
    ///         outflows, the same way stakeOutFeeBps works for principal.
    uint256 public rewardOutFeeBps;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewardsScaled; // reward * ACC

    event Staked(address indexed user, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, uint256 shares, uint256 amount);
    event EmergencyWithdrawn(address indexed user, uint256 shares, uint256 amount);
    event RewardPaid(address indexed user, uint256 gross, uint256 net, uint256 platformFee, uint256 creatorFee);
    event PlatformFeesCollected(address indexed recipient, uint256 amount);
    event CreatorFeesCollected(address indexed creator, uint256 amount);
    event UnallocatedRecovered(address indexed creator, uint256 amount);

    error NotFactory();
    error NotCreator();
    error AlreadyFunded();
    error NotFunded();
    error ZeroAmount();
    error PoolEnded();
    error PoolNotEnded();
    error CapExceeded();
    error InsufficientBalance();
    error PoolInsolvent();
    error AmountTooLarge();
    error ZeroAddress();

    constructor(
        address _creator,
        address _stakeToken,
        address _rewardToken,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _maxTotalStake,
        uint256 _claimFeeBps,
        string memory _name,
        string memory _description
    ) {
        if (_creator == address(0) || _stakeToken == address(0) || _rewardToken == address(0)) revert ZeroAddress();
        factory = msg.sender;
        creator = _creator;
        stakeToken = IERC20(_stakeToken);
        rewardToken = IERC20(_rewardToken);
        sameToken = _stakeToken == _rewardToken;
        startTime = _startTime;
        endTime = _endTime;
        maxTotalStake = _maxTotalStake;
        claimFeeBps = _claimFeeBps;
        name = _name;
        description = _description;
        lastUpdateTime = _startTime;
    }

    /// @dev Called by the factory right after it transfers the rewards in.
    function initializeRewards() external returns (uint256 received) {
        if (msg.sender != factory) revert NotFactory();
        if (funded) revert AlreadyFunded();
        received = rewardToken.balanceOf(address(this));
        // slither-disable-next-line incorrect-equality
        if (received == 0) revert ZeroAmount();
        if (received > type(uint128).max) revert AmountTooLarge();
        uint256 duration = endTime - startTime;
        uint256 scaled = received * RATE;
        funded = true;
        totalRewards = received;
        rewardReserve = received;
        rewardRate = scaled / duration;
        // rate truncation dust goes back to the creator, never lost
        unallocatedScaled = (scaled % duration) * RATE;
    }

    // ---------- views ----------

    function lastTimeRewardApplicable() public view returns (uint256) {
        // slither-disable-next-line timestamp
        if (block.timestamp < startTime) return startTime;
        // slither-disable-next-line timestamp
        return block.timestamp < endTime ? block.timestamp : endTime;
    }

    function _pending() internal view returns (uint256 rpt, uint256 rem, uint256 unalloc) {
        rpt = rewardPerTokenStored;
        rem = rewardRemainder;
        unalloc = unallocatedScaled;
        uint256 accrued = (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * RATE;
        if (totalStaked == 0) {
            unalloc += accrued;
        } else {
            uint256 num = accrued + rem;
            rpt += num / totalStaked;
            // slither-disable-next-line weak-prng
            rem = num % totalStaked; // carried to the next update instead of being lost
        }
    }

    function rewardPerToken() public view returns (uint256 rpt) {
        (rpt,,) = _pending();
    }

    function earnedScaled(address account) public view returns (uint256) {
        return balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) + rewardsScaled[account];
    }

    /// @notice Gross reward earned (before the claim fee).
    function earned(address account) public view returns (uint256) {
        return earnedScaled(account) / ACC;
    }

    /// @notice What the user receives if they claim now (after the claim fee).
    function claimable(address account) external view returns (uint256) {
        uint256 gross = earned(account);
        return gross - (gross * claimFeeBps) / BPS;
    }

    function pendingUnallocated() external view returns (uint256) {
        (,, uint256 unalloc) = _pending();
        return unalloc / ACC;
    }

    function isActive() external view returns (bool) {
        // slither-disable-next-line timestamp
        return funded && block.timestamp < endTime;
    }

    /// @notice Stake-token backing that belongs to stakers (excludes reward reserve in same-token pools).
    function principalBacking() public view returns (uint256) {
        uint256 bal = stakeToken.balanceOf(address(this));
        if (!sameToken) return bal;
        uint256 owed = totalStaked + rewardReserve;
        // slither-disable-next-line incorrect-equality
        if (owed == 0) return 0;
        if (bal >= owed) return totalStaked;
        return (bal * totalStaked) / owed; // shortfall shared pro-rata between principal and rewards
    }

    /// @notice Reward tokens that can currently be paid out without touching principal.
    function rewardAvailable() public view returns (uint256) {
        uint256 bal = rewardToken.balanceOf(address(this));
        if (!sameToken) return bal < rewardReserve ? bal : rewardReserve;
        uint256 owed = totalStaked + rewardReserve;
        // slither-disable-next-line incorrect-equality
        if (owed == 0) return 0;
        if (bal >= owed) return rewardReserve;
        return (bal * rewardReserve) / owed;
    }

    /// @notice Token amount `shares` currently redeem for.
    function sharesToAmount(uint256 shares) public view returns (uint256) {
        // slither-disable-next-line incorrect-equality
        if (totalStaked == 0) return shares;
        uint256 backing = principalBacking();
        if (backing >= totalStaked) return shares;
        return (shares * backing) / totalStaked;
    }

    // ---------- internal accounting ----------

    function _updateReward(address account) internal {
        (uint256 rpt, uint256 rem, uint256 unalloc) = _pending();
        rewardPerTokenStored = rpt;
        rewardRemainder = rem;
        unallocatedScaled = unalloc;
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewardsScaled[account] += balanceOf[account] * (rpt - userRewardPerTokenPaid[account]);
            userRewardPerTokenPaid[account] = rpt;
        }
    }

    /// @dev Called right before totalStaked changes: the carried remainder was earned by the
    ///      previous stake set; it must not be handed to the new set, so it goes to the creator.
    function _flushRemainder() internal {
        unallocatedScaled += rewardRemainder;
        rewardRemainder = 0;
    }

    /// @dev Caps an outgoing reward-side amount to what the reward reserve can cover.
    ///      The cap is on the real outflow (amount + any sender-side token fee), so the
    ///      transfer can never need more than the reserve holds.
    function _capReward(uint256 amount) internal view returns (uint256) {
        uint256 avail = rewardAvailable();
        uint256 maxSend = (avail * BPS) / (BPS + rewardOutFeeBps);
        // slither-disable-next-line timestamp
        return amount < maxSend ? amount : maxSend;
    }

    /// @dev Pays `amount` (already capped) out of the reward reserve. The real outflow, including any
    ///      sender-side token fee, is charged to the reward reserve so it can never consume principal.
    ///      The sender-side fee rate is learned from the observed outflow (mirrors _sendPrincipal),
    ///      so later payouts can be sized to fit. All callers are nonReentrant; the post-call write
    ///      is needed to measure the real outflow.
    // slither-disable-next-line reentrancy-benign,reentrancy-no-eth
    function _sendReward(address to, uint256 amount) internal {
        // slither-disable-next-line incorrect-equality,timestamp
        if (amount == 0) return;
        uint256 before = rewardToken.balanceOf(address(this));
        rewardToken.safeTransfer(to, amount);
        uint256 out = before - rewardToken.balanceOf(address(this));
        if (out > amount) {
            uint256 feeBps = Math.mulDiv(out - amount, BPS, amount, Math.Rounding.Ceil);
            if (feeBps > BPS) feeBps = BPS;
            if (feeBps > rewardOutFeeBps) rewardOutFeeBps = feeBps;
        }
        // slither-disable-next-line reentrancy-no-eth
        rewardReserve -= out < rewardReserve ? out : rewardReserve;
    }

    /// @dev Sends principal so that the pool's real outflow is at most `amount`, using the learned
    ///      sender-side fee of the token; if the token charges more than learned, the new rate is
    ///      recorded so later withdrawals are charged correctly. All callers are nonReentrant.
    // slither-disable-next-line reentrancy-benign,reentrancy-no-eth
    function _sendPrincipal(address to, uint256 amount) internal {
        uint256 send = (amount * BPS) / (BPS + stakeOutFeeBps);
        // slither-disable-next-line incorrect-equality
        if (send == 0) return;
        uint256 before = stakeToken.balanceOf(address(this));
        stakeToken.safeTransfer(to, send);
        uint256 out = before - stakeToken.balanceOf(address(this));
        if (out > send) {
            uint256 feeBps = Math.mulDiv(out - send, BPS, send, Math.Rounding.Ceil);
            if (feeBps > BPS) feeBps = BPS;
            if (feeBps > stakeOutFeeBps) stakeOutFeeBps = feeBps;
        }
    }

    // ---------- user actions ----------

    // slither-disable-next-line reentrancy-no-eth,reentrancy-balance,reentrancy-benign
    function stake(uint256 amount) external nonReentrant {
        if (!funded) revert NotFunded();
        if (amount == 0) revert ZeroAmount();
        // slither-disable-next-line timestamp
        if (block.timestamp >= endTime) revert PoolEnded();
        _updateReward(msg.sender);
        _flushRemainder();

        // pre-transfer snapshots are intentional (measure real amount received / mint at the
        // pre-deposit ratio); every state-changing function is nonReentrant.
        uint256 backingBefore = principalBacking();
        uint256 before = stakeToken.balanceOf(address(this));
        // slither-disable-next-line reentrancy-balance,reentrancy-benign
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = stakeToken.balanceOf(address(this)) - before;
        // slither-disable-next-line incorrect-equality,reentrancy-balance
        if (received == 0) revert ZeroAmount();

        uint256 shares = received;
        if (totalStaked > 0 && backingBefore < totalStaked) {
            // pool is short (negative rebase / token fees): mint at the real ratio so new
            // stakers do not subsidise existing losses
            // slither-disable-next-line incorrect-equality,reentrancy-balance
            if (backingBefore == 0) revert PoolInsolvent();
            shares = (received * totalStaked) / backingBefore;
        }
        // slither-disable-next-line reentrancy-balance
        if (maxTotalStake != 0 && totalStaked + shares > maxTotalStake) revert CapExceeded();

        // slither-disable-next-line incorrect-equality
        if (balanceOf[msg.sender] == 0) stakerCount += 1;
        balanceOf[msg.sender] += shares;
        totalStaked += shares;
        emit Staked(msg.sender, received, shares);
    }

    function withdraw(uint256 shares) external nonReentrant {
        _withdraw(msg.sender, shares);
    }

    function claim() external nonReentrant {
        _claim(msg.sender, type(uint256).max);
    }

    /// @notice Claim up to `grossAmount` of earned rewards (gross, before the claim fee).
    ///         Partial claims always work: even if the reward token raised its sender-side
    ///         fee after the pool was funded, a small enough claim still fits the room, so
    ///         rewards can never be frozen by a fee the pool has not learned yet.
    function claimAmount(uint256 grossAmount) external nonReentrant {
        if (grossAmount == 0) revert ZeroAmount();
        _claim(msg.sender, grossAmount);
    }

    function exit() external nonReentrant {
        _withdraw(msg.sender, balanceOf[msg.sender]);
        _claim(msg.sender, type(uint256).max);
    }

    /// @notice Withdraw principal without claiming (rewards forfeited to the creator). Always available.
    function emergencyWithdraw() external nonReentrant {
        uint256 shares = balanceOf[msg.sender];
        if (shares == 0) revert ZeroAmount();
        _updateReward(address(0));
        _flushRemainder();
        uint256 amount = sharesToAmount(shares);
        unallocatedScaled +=
            shares * (rewardPerTokenStored - userRewardPerTokenPaid[msg.sender]) + rewardsScaled[msg.sender];
        rewardsScaled[msg.sender] = 0;
        userRewardPerTokenPaid[msg.sender] = rewardPerTokenStored;
        balanceOf[msg.sender] = 0;
        totalStaked -= shares;
        stakerCount -= 1;
        emit EmergencyWithdrawn(msg.sender, shares, amount);
        _sendPrincipal(msg.sender, amount);
    }

    function _withdraw(address user, uint256 shares) internal {
        if (shares == 0) revert ZeroAmount();
        if (shares > balanceOf[user]) revert InsufficientBalance();
        _updateReward(user);
        _flushRemainder();
        uint256 amount = sharesToAmount(shares);
        balanceOf[user] -= shares;
        totalStaked -= shares;
        if (balanceOf[user] == 0) stakerCount -= 1;
        emit Withdrawn(user, shares, amount);
        _sendPrincipal(user, amount);
    }

    function _claim(address user, uint256 maxGross) internal {
        _updateReward(user);
        uint256 owedScaled = rewardsScaled[user];
        uint256 gross = owedScaled / ACC;
        // the claim fee stays inside the reserve, so the whole gross amount must fit in the
        // reward room left after fees that are already owed to the platform / creator
        uint256 committed = platformFeesAccrued + creatorFeesAccrued;
        uint256 avail = rewardAvailable();
        uint256 room = avail > committed ? avail - committed : 0;
        // slither-disable-next-line timestamp
        if (gross > room) gross = room; // reward side short: pay what exists, the rest stays owed
        if (gross > maxGross) gross = maxGross; // partial claim: only take what was asked for
        // Size the claim so the real outflow fits the room. The reward token may take a
        // sender-side fee on top of the payout (net + tax), so the net that can be sent is
        // room / (1 + learned fee); the gross is backed out from that net. Without this,
        // a claim near the room would revert and the rewards would be frozen, because
        // claim() takes no amount. For a plain token the learned fee is 0 and this cap
        // is exactly the room cap above, so behaviour is unchanged. The learned rate can
        // go stale if the token raises its fee mid-pool; then a full claim may revert,
        // but a small claimAmount still fits and re-learns the higher rate.
        uint256 maxNet = (room * BPS) / (BPS + rewardOutFeeBps);
        uint256 maxGrossByFee = Math.mulDiv(maxNet, BPS, BPS - claimFeeBps);
        if (gross > maxGrossByFee) gross = maxGrossByFee;
        // slither-disable-next-line incorrect-equality,incorrect-equality,timestamp
        if (gross == 0) return;
        uint256 fee = Math.mulDiv(gross, claimFeeBps, BPS);
        uint256 platformFee = Math.mulDiv(gross, claimFeeBps * PLATFORM_SHARE_BPS, BPS * BPS);
        uint256 creatorFee = fee - platformFee;
        uint256 net = gross - fee;
        // Final guard against rounding dust: the fee on the reduced gross is at most a few
        // wei of rounding, so one trim makes the worst-case outflow fit the room. If it
        // still would not fit, pay nothing and leave the balance owed rather than reverting.
        uint256 out = Math.mulDiv(net, BPS + rewardOutFeeBps, BPS, Math.Rounding.Ceil);
        if (out > room) {
            uint256 excess = out - room;
            if (gross <= excess + 1) return;
            gross -= excess + 1;
            fee = Math.mulDiv(gross, claimFeeBps, BPS);
            platformFee = Math.mulDiv(gross, claimFeeBps * PLATFORM_SHARE_BPS, BPS * BPS);
            creatorFee = fee - platformFee;
            net = gross - fee;
            out = Math.mulDiv(net, BPS + rewardOutFeeBps, BPS, Math.Rounding.Ceil);
            if (out > room) return;
        }
        // exact: only whole tokens leave the scaled balance, the fractional part stays with the user
        // slither-disable-next-line divide-before-multiply
        rewardsScaled[user] = owedScaled - gross * ACC;
        totalRewardsPaid += gross;
        platformFeesAccrued += platformFee;
        creatorFeesAccrued += creatorFee;
        emit RewardPaid(user, gross, net, platformFee, creatorFee);
        _sendReward(user, net);
    }

    // ---------- fees (pull pattern; anyone may trigger, funds only go to the fixed recipients) ----------

    function collectPlatformFees() external nonReentrant {
        uint256 amount = _capReward(platformFeesAccrued);
        // slither-disable-next-line incorrect-equality,timestamp
        if (amount == 0) revert ZeroAmount();
        address recipient = IPolydashStakingFactoryV2(factory).feeRecipient();
        platformFeesAccrued -= amount;
        emit PlatformFeesCollected(recipient, amount);
        _sendReward(recipient, amount);
    }

    function collectCreatorFees() external nonReentrant {
        uint256 amount = _capReward(creatorFeesAccrued);
        // slither-disable-next-line incorrect-equality,timestamp
        if (amount == 0) revert ZeroAmount();
        creatorFeesAccrued -= amount;
        emit CreatorFeesCollected(creator, amount);
        _sendReward(creator, amount);
    }

    /// @notice After the end the creator recovers rewards that were never allocated
    ///         (zero-staker periods, forfeited rewards, rounding remainders).
    function recoverUnallocated() external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        // slither-disable-next-line timestamp
        if (block.timestamp < endTime) revert PoolNotEnded();
        _updateReward(address(0));
        _flushRemainder();
        uint256 amount = _capReward(unallocatedScaled / ACC);
        // slither-disable-next-line incorrect-equality
        if (amount == 0) revert ZeroAmount();
        // slither-disable-next-line divide-before-multiply
        unallocatedScaled -= amount * ACC;
        emit UnallocatedRecovered(creator, amount);
        _sendReward(creator, amount);
    }
}
