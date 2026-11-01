// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IBurnableERC20} from "./IPolydashLaunchInfo.sol";

/// @title CreatorBond (DRAFT - not reviewed, not deployed)
/// @notice A creator posts ETH for a fixed period and commits that a set of registered wallets will keep
///         holding at least `floor` tokens (in aggregate) until the period ends.
///
///         Rug condition (the only one, objectively checkable at call time):
///             sum(balanceOf(registered wallets)) < floor,   floor = committed * (10_000 - allowanceBps) / 10_000
///         - Balances, not transfers: tokens sent INTO registered wallets only raise the sum, so outsiders can't
///           grief. Moves between registered wallets don't count. Selling, burning, staking or moving tokens to any
///           unregistered address all lower the sum and count.
///         - Polypad tokens have no mint/owner/pause/tax, and graduated LP is owned by the hook forever with no
///           removal path, so "LP pulled" and "permission change" conditions cannot happen and are not encoded.
///
///         Lifecycle: Pending -> (every non-creator wallet calls confirmWallet) -> Active -> Refunded | Slashed.
///         Pending: creator may cancel and take the ETH back. Active: anyone may slash() while the condition
///         holds and block.timestamp < endTime. After endTime the creator may refund() if the condition does
///         NOT hold at that moment. No admin, no oracle, no owner, nothing upgradeable.
///
///         Payout on slash (snapshot-free): a fixed redemption rate is fixed at slash time,
///             rate = pot / token.totalSupply()
///         Any non-registered holder may burn tokens to receive amount * rate. Because the denominator is the
///         whole supply (including pool reserves and creator wallets), the sum of all claims can never exceed
///         the pot, so there is no first-come race. Late buyers pay the market price for tokens that redeem at
///         a fixed rate, so farming yields nothing beyond arbitrage, and that arbitrage lifts the price for
///         holders who sell instead of burning. The share attributable to pool reserves and registered wallets
///         only becomes claimable if those tokens end up with non-registered holders; anything never claimed
///         stays in this contract forever (there is no sweep, by design: no admin).
contract CreatorBond is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Pending,
        Active,
        Refunded,
        Slashed,
        Cancelled
    }

    uint256 public constant BPS = 10_000;

    address public immutable factory;
    address public immutable token;
    address public immutable creator;
    uint256 public immutable committed;
    uint256 public immutable allowanceBps;
    uint256 public immutable duration;
    uint256 public immutable bondAmount;

    address[] internal _wallets;
    mapping(address => bool) public isRegistered;
    mapping(address => bool) public isConfirmed;
    uint256 public pendingConfirmations;

    Status public status;
    uint256 public startTime;
    uint256 public endTime;

    // slash payout state
    uint256 public pot;
    uint256 public supplyAtSlash;
    uint256 public totalPaid;
    uint256 public totalBurned;

    event WalletConfirmed(address indexed wallet);
    event Activated(uint256 startTime, uint256 endTime, uint256 aggregateBalance);
    event Cancelled(uint256 amount);
    event Refunded(address indexed creator, uint256 amount);
    event Slashed(address indexed caller, uint256 aggregateBalance, uint256 floor, uint256 pot, uint256 supply);
    event Redeemed(address indexed holder, uint256 tokensBurned, uint256 ethOut);

    error OnlyCreator();
    error NotRegistered();
    error AlreadyConfirmed();
    error BadStatus();
    error BelowFloor();
    error NotEnded();
    error Ended();
    error NotRugged();
    error ZeroAmount();
    error RegisteredCannotRedeem();
    error TransferFailed();

    /// @dev Deployed by CreatorBondFactory, which validates inputs and forwards the ETH.
    constructor(
        address _token,
        address _creator,
        address[] memory wallets_,
        uint256 _committed,
        uint256 _allowanceBps,
        uint256 _duration
    ) payable {
        factory = msg.sender;
        token = _token;
        creator = _creator;
        committed = _committed;
        allowanceBps = _allowanceBps;
        duration = _duration;
        bondAmount = msg.value;
        uint256 pending;
        for (uint256 i; i < wallets_.length; ++i) {
            address w = wallets_[i];
            _wallets.push(w);
            isRegistered[w] = true;
            if (w == _creator) isConfirmed[w] = true;
            else ++pending;
        }
        pendingConfirmations = pending;
        if (pending == 0) _activate();
    }

    // ------------------------------------------------------------------ views

    function wallets() external view returns (address[] memory) {
        return _wallets;
    }

    function floor() public view returns (uint256) {
        return committed * (BPS - allowanceBps) / BPS;
    }

    function aggregateBalance() public view returns (uint256 sum) {
        IERC20 t = IERC20(token);
        uint256 n = _wallets.length;
        for (uint256 i; i < n; ++i) {
            sum += t.balanceOf(_wallets[i]);
        }
    }

    /// @notice True if the rug condition holds right now (regardless of status/time).
    function isBelowFloor() public view returns (bool) {
        return aggregateBalance() < floor();
    }

    /// @notice True if slash() would succeed right now.
    function canSlash() external view returns (bool) {
        return status == Status.Active && block.timestamp < endTime && isBelowFloor();
    }

    /// @notice ETH a holder would receive for burning `amount` tokens (0 unless slashed).
    function quoteRedeem(uint256 amount) external view returns (uint256) {
        if (status != Status.Slashed) return 0;
        return amount * pot / supplyAtSlash;
    }

    // ------------------------------------------------------------------ pending phase

    /// @notice A registered (non-creator) wallet proves control and accepts being bound to the bond.
    ///         Prevents a creator from "committing" balances of wallets they don't control (CEX, pools, vaults).
    function confirmWallet() external nonReentrant {
        if (status != Status.Pending) revert BadStatus();
        if (!isRegistered[msg.sender]) revert NotRegistered();
        if (isConfirmed[msg.sender]) revert AlreadyConfirmed();
        isConfirmed[msg.sender] = true;
        emit WalletConfirmed(msg.sender);
        if (--pendingConfirmations == 0) _activate();
    }

    /// @notice Creator withdraws the bond before it ever became active.
    function cancel() external nonReentrant {
        if (msg.sender != creator) revert OnlyCreator();
        if (status != Status.Pending) revert BadStatus();
        status = Status.Cancelled;
        uint256 amt = address(this).balance;
        emit Cancelled(amt);
        _send(creator, amt);
    }

    function _activate() internal {
        uint256 bal = aggregateBalance();
        if (bal < committed) revert BelowFloor();
        status = Status.Active;
        startTime = block.timestamp;
        endTime = block.timestamp + duration;
        emit Activated(startTime, endTime, bal);
    }

    // ------------------------------------------------------------------ active phase

    /// @notice Permissionless. Succeeds only if the registered wallets' aggregate balance is below the floor
    ///         before the bond ends. The proof is the on-chain balance itself.
    function slash() external nonReentrant {
        if (status != Status.Active) revert BadStatus();
        // slither-disable-next-line timestamp
        if (block.timestamp >= endTime) revert Ended();
        uint256 bal = aggregateBalance();
        uint256 f = floor();
        if (bal >= f) revert NotRugged();
        uint256 supply = IERC20(token).totalSupply();
        status = Status.Slashed;
        pot = address(this).balance;
        supplyAtSlash = supply;
        emit Slashed(msg.sender, bal, f, pot, supply);
    }

    /// @notice Creator reclaims the bond after the period, only if the floor still holds at that moment.
    ///         (Prevents "sell in the last block, then refund".)
    function refund() external nonReentrant {
        if (msg.sender != creator) revert OnlyCreator();
        if (status != Status.Active) revert BadStatus();
        // slither-disable-next-line timestamp
        if (block.timestamp < endTime) revert NotEnded();
        if (isBelowFloor()) revert BelowFloor();
        status = Status.Refunded;
        uint256 amt = address(this).balance;
        emit Refunded(creator, amt);
        _send(creator, amt);
    }

    // ------------------------------------------------------------------ slashed phase

    /// @notice Burn `amount` tokens for amount * pot / supplyAtSlash ETH. Registered wallets may not redeem.
    function redeem(uint256 amount) external nonReentrant returns (uint256 ethOut) {
        if (status != Status.Slashed) revert BadStatus();
        if (amount == 0) revert ZeroAmount();
        if (isRegistered[msg.sender]) revert RegisteredCannotRedeem();
        ethOut = amount * pot / supplyAtSlash;
        if (ethOut == 0) revert ZeroAmount();
        totalPaid += ethOut;
        totalBurned += amount;
        emit Redeemed(msg.sender, amount, ethOut);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        IBurnableERC20(token).burn(amount);
        _send(msg.sender, ethOut);
    }

    function _send(address to, uint256 amt) internal {
        if (amt == 0) return;
        // slither-disable-next-line arbitrary-send-eth,low-level-calls
        (bool ok,) = to.call{value: amt}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev No receive(): ETH can only enter via the constructor (forced sends via selfdestruct just raise the pot).
}
