// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFundFeeRecipient {
    function feeRecipient() external view returns (address);
}

/// @title FundVault (DRAFT - not reviewed, not deployed)
/// @notice Holds the ETH paid to mint one fund's NFTs.
///         Phase 1a has two statuses: Raising, then RaisingClosed. There is no investing
///         step in this phase, and there is no function that sends principal to the manager
///         or to anyone else.
///         `raised` is the gross ETH paid through mints. Entry fees and the protocol fee are
///         counted out of that gross amount and can be pulled. The remainder stays as principal.
///         Direct ETH transfers revert. ETH forced in (for example by selfdestruct) stays in the
///         vault, counts toward `navPerNft` on the NFT, and cannot be withdrawn here.
contract FundVault is ReentrancyGuard {
    uint256 public constant BPS = 10_000;

    enum Status {
        Raising,
        RaisingClosed
    }

    address public immutable factory;
    address public immutable manager;
    uint256 public immutable raiseCap;
    uint256 public immutable maxSupply;
    uint256 public immutable entryFeeBps;
    uint256 public immutable protocolFeeBps;

    address public nft;
    address public payoutWallet;
    Status public status;
    uint256 public raised;
    uint256 public principal;
    uint256 public entryFeeAccrued;
    uint256 public entryFeeClaimed;
    uint256 public protocolFeeAccrued;
    uint256 public protocolFeeClaimed;

    event Bound(address indexed nft);
    event Deposited(uint256 gross, uint256 principalAdded, uint256 entryFee, uint256 protocolFee);
    event RaiseClosed(uint256 raised, uint256 minted);
    event EntryFeeWithdrawn(address indexed to, uint256 amount);
    event ProtocolFeeWithdrawn(address indexed to, uint256 amount);
    event PayoutWalletSet(address indexed wallet);

    error NotFactory();
    error NotNft();
    error NotManager();
    error NotRaising();
    error AlreadyBound();
    error BadValue();
    error NothingToWithdraw();
    error TransferFailed();
    error ZeroAddress();
    error DirectTransfer();

    modifier onlyNft() {
        if (msg.sender != nft || nft == address(0)) revert NotNft();
        _;
    }

    constructor(
        address _manager,
        uint256 _raiseCap,
        uint256 _maxSupply,
        uint256 _entryFeeBps,
        uint256 _protocolFeeBps
    ) {
        if (_manager == address(0)) revert ZeroAddress();
        factory = msg.sender;
        manager = _manager;
        raiseCap = _raiseCap;
        maxSupply = _maxSupply;
        entryFeeBps = _entryFeeBps;
        protocolFeeBps = _protocolFeeBps;
        payoutWallet = _manager;
        status = Status.Raising;
    }

    /// @dev Mint ETH arrives only through `deposit`. A plain transfer reverts.
    receive() external payable {
        revert DirectTransfer();
    }

    /// @notice One-time link to the FundNFT the factory just deployed.
    function bind(address _nft) external {
        if (msg.sender != factory) revert NotFactory();
        if (nft != address(0) || _nft == address(0)) revert AlreadyBound();
        nft = _nft;
        emit Bound(_nft);
    }

    /// @notice Record one mint payment. Fees must match this vault's bps, floored independently.
    ///         Callable only by the bound NFT, and only while Raising.
    function deposit(uint256 entryFee, uint256 protocolFee) external payable nonReentrant onlyNft {
        if (status != Status.Raising) revert NotRaising();
        uint256 expectEntry = (msg.value * entryFeeBps) / BPS;
        uint256 expectProtocol = (msg.value * protocolFeeBps) / BPS;
        if (entryFee != expectEntry || protocolFee != expectProtocol) revert BadValue();
        uint256 net = msg.value - entryFee - protocolFee;
        raised += msg.value;
        principal += net;
        entryFeeAccrued += entryFee;
        protocolFeeAccrued += protocolFee;
        emit Deposited(msg.value, net, entryFee, protocolFee);
    }

    /// @notice Close the raise once gross ETH has reached the cap or maxSupply NFTs exist.
    ///         Does nothing if the condition is not met. Cannot reopen.
    function closeIfReady(uint256 minted) external onlyNft {
        if (status != Status.Raising) return;
        if (raised >= raiseCap || minted >= maxSupply) {
            status = Status.RaisingClosed;
            emit RaiseClosed(raised, minted);
        }
    }

    function claimableEntryFee() public view returns (uint256) {
        return entryFeeAccrued - entryFeeClaimed;
    }

    function claimableProtocolFee() public view returns (uint256) {
        return protocolFeeAccrued - protocolFeeClaimed;
    }

    /// @notice Manager pulls accrued entry fees to the payout wallet. Principal stays.
    function withdrawEntryFee() external nonReentrant {
        if (msg.sender != manager) revert NotManager();
        uint256 amount = claimableEntryFee();
        if (amount == 0) revert NothingToWithdraw();
        entryFeeClaimed = entryFeeAccrued;
        emit EntryFeeWithdrawn(payoutWallet, amount);
        _send(payoutWallet, amount);
    }

    /// @notice Anyone may pull accrued protocol fees to the factory's current fee recipient.
    function withdrawProtocolFee() external nonReentrant {
        uint256 amount = claimableProtocolFee();
        if (amount == 0) revert NothingToWithdraw();
        address to = IFundFeeRecipient(factory).feeRecipient();
        if (to == address(0)) revert ZeroAddress();
        protocolFeeClaimed = protocolFeeAccrued;
        emit ProtocolFeeWithdrawn(to, amount);
        _send(to, amount);
    }

    /// @notice Where entry fees are sent. Does not grant access to principal.
    function setPayoutWallet(address wallet) external {
        if (msg.sender != manager) revert NotManager();
        if (wallet == address(0)) revert ZeroAddress();
        payoutWallet = wallet;
        emit PayoutWalletSet(wallet);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
