// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PolydashRewardsPool (not audited)
/// @notice Single-sided, ongoing POLYDASH staking: stake POLYDASH, earn POLYDASH. Synthetix-style rewardPerToken.
///   Anyone can add rewards with notifyRewardAmount(amount); each top-up is added to whatever is still unstreamed
///   and the total is re-streamed over REWARDS_DURATION (rolling). Nothing pays out instantly.
///   Rewards that would accrue while nobody is staked, and rate rounding dust, are carried into the next stream.
///   Principal (totalStaked) and rewards (rewardReserve) are tracked separately; rewards never pay out of principal.
///   No owner, no admin, no lock, no fee. Unstake any time. Tokens sent directly (donations) are ignored until
///   anyone calls syncDonations(), which streams them as rewards.
contract PolydashRewardsPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant REWARDS_DURATION = 30 days;
    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 public constant MIN_RESTREAM_BPS = 100; // 1% of the amount still streaming

    IERC20 public immutable token;

    uint256 public totalStaked;
    mapping(address => uint256) public balanceOf;

    uint256 public rewardRate; // reward tokens per second, scaled by PRECISION
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored; // scaled by PRECISION
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    /// Reward tokens committed to stakers (streamed-but-unclaimed + still streaming + carried). Never principal.
    uint256 public rewardReserve;
    /// Reward tokens (scaled by PRECISION) not yet scheduled: zero-stake periods and rate rounding dust.
    uint256 public carryScaled;

    uint256 public totalNotified;
    uint256 public totalClaimed;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 amount);
    event RewardAdded(address indexed from, uint256 amount, uint256 rewardRate, uint256 periodFinish);
    event Restreamed(uint256 carried, uint256 rewardRate, uint256 periodFinish);

    error ZeroAmount();
    error Insufficient();

    constructor(address _token) {
        if (_token == address(0)) revert ZeroAmount();
        token = IERC20(_token);
    }

    // ---------------------------------------------------------------- views

    /// @notice Ongoing pool: no end. Present so integrators that check endTime() see an active pool.
    function endTime() external pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice Marker read by the buyback vault: this pool accepts reward top-ups via notifyRewardAmount.
    function acceptsRewardTopUps() external pure returns (bool) {
        return true;
    }

    function stakeToken() external view returns (address) {
        return address(token);
    }

    function rewardToken() external view returns (address) {
        return address(token);
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate) / totalStaked;
    }

    function earned(address a) public view returns (uint256) {
        return rewards[a] + (balanceOf[a] * (rewardPerToken() - userRewardPerTokenPaid[a])) / PRECISION;
    }

    /// @notice Reward tokens per second currently streaming (unscaled; for "Current APR (variable)" displays).
    function rewardPerSecond() external view returns (uint256) {
        return block.timestamp < periodFinish ? rewardRate / PRECISION : 0;
    }

    function donations() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        uint256 owed = totalStaked + rewardReserve;
        return bal > owed ? bal - owed : 0;
    }

    // ---------------------------------------------------------------- accounting

    function _update(address a) internal {
        uint256 t = lastTimeRewardApplicable();
        if (totalStaked == 0) {
            // nobody staked: what would have streamed is carried, not lost
            carryScaled += (t - lastUpdateTime) * rewardRate;
        } else {
            uint256 accrued = (t - lastUpdateTime) * rewardRate;
            uint256 inc = accrued / totalStaked;
            rewardPerTokenStored += inc;
            carryScaled += accrued - inc * totalStaked; // division dust
        }
        lastUpdateTime = t;
        if (a != address(0)) {
            rewards[a] = earned(a);
            userRewardPerTokenPaid[a] = rewardPerTokenStored;
        }
    }

    /// @dev Re-stream leftover + carry + `added` over REWARDS_DURATION from now.
    function _restream(uint256 addedScaled) internal {
        uint256 leftover = block.timestamp < periodFinish ? (periodFinish - block.timestamp) * rewardRate : 0;
        uint256 total = leftover + carryScaled + addedScaled;
        rewardRate = total / REWARDS_DURATION;
        carryScaled = total - rewardRate * REWARDS_DURATION; // rate dust carried
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + REWARDS_DURATION;
    }

    // ---------------------------------------------------------------- rewards in

    /// @notice Anyone: add `amount` POLYDASH as rewards (pulled with transferFrom). Re-streams over 30 days.
    function notifyRewardAmount(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _update(address(0));
        uint256 b = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - b;
        rewardReserve += received;
        totalNotified += received;
        _addAndMaybeRestream(received);
    }

    /// @dev Anti-griefing: a top-up smaller than MIN_RESTREAM_BPS of what is still streaming does not restart
    ///   the 30-day clock (which would slow the current stream); it is carried and folded into the next restream.
    function _addAndMaybeRestream(uint256 amount) internal {
        uint256 leftover = block.timestamp < periodFinish ? (periodFinish - block.timestamp) * rewardRate : 0;
        if (amount * PRECISION * BPS < leftover * MIN_RESTREAM_BPS) {
            carryScaled += amount * PRECISION;
            emit RewardAdded(msg.sender, amount, rewardRate, periodFinish);
            return;
        }
        _restream(amount * PRECISION);
        emit RewardAdded(msg.sender, amount, rewardRate, periodFinish);
    }

    /// @notice Anyone: stream tokens sent directly to the pool as rewards.
    function syncDonations() external nonReentrant {
        uint256 d = donations();
        if (d == 0) revert ZeroAmount();
        _update(address(0));
        rewardReserve += d;
        totalNotified += d;
        _addAndMaybeRestream(d);
    }

    /// @notice Anyone: re-stream carried rewards (e.g. after a zero-stake period) when stakers are present.
    function restreamCarry() external nonReentrant {
        _update(address(0));
        if (carryScaled < REWARDS_DURATION || totalStaked == 0) revert ZeroAmount();
        // only when the stream has ended or carry is material, so this cannot be used to stall the stream
        uint256 leftover = block.timestamp < periodFinish ? (periodFinish - block.timestamp) * rewardRate : 0;
        if (carryScaled * BPS < leftover * MIN_RESTREAM_BPS) revert ZeroAmount();
        uint256 c = carryScaled;
        _restream(0);
        emit Restreamed(c, rewardRate, periodFinish);
    }

    // ---------------------------------------------------------------- users

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _update(msg.sender);
        bool wasEmpty = totalStaked == 0;
        uint256 b = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - b;
        totalStaked += received;
        balanceOf[msg.sender] += received;
        // first staker after an empty period: fold carried rewards back into the stream
        if (wasEmpty && carryScaled >= REWARDS_DURATION) _restream(0);
        emit Staked(msg.sender, received);
    }

    function withdraw(uint256 amount) public nonReentrant {
        _withdraw(msg.sender, amount);
    }

    function claim() public nonReentrant {
        _claim(msg.sender);
    }

    function exit() external nonReentrant {
        _withdraw(msg.sender, balanceOf[msg.sender]);
        _claim(msg.sender);
    }

    function _withdraw(address u, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        if (amount > balanceOf[u]) revert Insufficient();
        _update(u);
        balanceOf[u] -= amount;
        totalStaked -= amount;
        token.safeTransfer(u, amount);
        emit Withdrawn(u, amount);
    }

    function _claim(address u) internal {
        _update(u);
        uint256 r = rewards[u];
        if (r == 0) return;
        rewards[u] = 0;
        rewardReserve -= r; // reverts rather than touching principal
        totalClaimed += r;
        token.safeTransfer(u, r);
        emit RewardPaid(u, r);
    }
}
