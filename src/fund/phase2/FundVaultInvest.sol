// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundAllowlist, IFundUnit} from "./Interfaces.sol";
import {NAVReader} from "./NAVReader.sol";
import {FundSwapFacet} from "./FundSwapFacet.sol";
import {FundVaultStore} from "./FundVaultStore.sol";

/// @title FundVaultInvest (not reviewed, not deployed)
/// @notice Raise vault plus an investing step. Phase 1a `FundVault` is unchanged and stays raise-only.
///         Status moves Raising → RaisingClosed → Investing, or Raising → Failed after the deadline.
///         There is no function that sends principal to the manager.
///         A failed raise refunds the current holder their share of spendable ETH. Fees stay separate.
///         After a successful close, a holder can exit for ETH, WETH, and mandate tokens, including dust on the last units.
///         `nav()` quotes mandate assets from the allowlist feed and reverts when that price cannot be used.
///         Cost basis is not NAV.
contract FundVaultInvest is ReentrancyGuard, FundVaultStore {
    address public immutable swapFacet;

    modifier onlyNft() {
        if (msg.sender != nft || nft == address(0)) revert NotNft();
        _;
    }

    constructor(
        address _manager,
        uint256 _raiseCap,
        uint256 _maxSupply,
        uint256 _entryFeeBps,
        uint256 _protocolFeeBps,
        address _allowlist,
        address _weth,
        bytes32 _mandateHash,
        address[] memory assets,
        address _swapFacet,
        uint64 _raiseDeadline,
        address _factory
    ) {
        if (
            _manager == address(0) || _allowlist == address(0) || _weth == address(0) || _swapFacet == address(0)
                || _factory == address(0)
        ) revert ZeroAddress();
        if (_swapFacet.code.length == 0) revert BadRouter();
        if (_mandateHash == bytes32(0) || _raiseDeadline <= block.timestamp) revert BadValue();
        if (assets.length > MAX_ASSETS) revert TooMany();
        if (!IFundAllowlist(_allowlist).assetAllowed(_weth)) revert NotAllowlisted();

        swapFacet = _swapFacet;
        factory = _factory;
        manager = _manager;
        raiseCap = _raiseCap;
        maxSupply = _maxSupply;
        entryFeeBps = _entryFeeBps;
        protocolFeeBps = _protocolFeeBps;
        allowlist = IFundAllowlist(_allowlist);
        weth = _weth;
        mandateHash = _mandateHash;
        universeHash = keccak256(abi.encode(assets));
        payoutWallet = _manager;
        raiseDeadline = _raiseDeadline;
        status = Status.Raising;

        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            if (asset == address(0) || asset == _weth || asset == _allowlist) revert BadPair();
            if (inMandate[asset]) revert BadPair();
            if (!IFundAllowlist(_allowlist).assetAllowed(asset)) revert NotAllowlisted();
            inMandate[asset] = true;
            _mandateAssets.push(asset);
        }
    }

    /// @dev Mint ETH arrives only through `deposit`. Router refunds are accepted while a swap is in progress.
    receive() external payable {
        if (!inSwap) revert DirectTransfer();
    }

    function bind(address _nft) external {
        if (msg.sender != factory) revert NotFactory();
        if (nft != address(0) || _nft == address(0)) revert AlreadyBound();
        nft = _nft;
        emit Bound(_nft);
    }

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

    function closeIfReady(uint256 minted) external onlyNft {
        if (status != Status.Raising) return;
        if (block.timestamp > raiseDeadline) return;
        if (raised >= raiseCap || minted >= maxSupply) {
            status = Status.RaisingClosed;
            emit RaiseClosed(raised, minted);
        }
    }

    /// @notice Anyone may close a raise that missed its deadline and did not fill.
    function failRaise() external {
        if (status != Status.Raising) revert NotRaising();
        if (block.timestamp <= raiseDeadline) revert TooEarly();
        status = Status.Failed;
        emit RaiseFailed(raised, nft == address(0) ? 0 : IFundUnit(nft).totalMinted());
    }

    /// @notice Pay the current holder their share of a failed raise. Called by the NFT after it burns.
    ///         Unclaimed entry and protocol fees are not part of the payout.
    function settleRefund(address to, uint256 n, uint256 supplyBefore) external nonReentrant onlyNft {
        if (status != Status.Failed) revert NotFailed();
        uint256 ethOut = _settle(to, n, supplyBefore);
        emit Refunded(to, n, ethOut);
    }

    /// @notice Pay the current holder their share of vault inventory. Pause does not block this.
    ///         The last outstanding units receive the rounding dust. A short token transfer reverts.
    function settleExit(address to, uint256 n, uint256 supplyBefore) external nonReentrant onlyNft {
        if (status != Status.RaisingClosed && status != Status.Investing) revert NotExitable();
        uint256 ethOut = _settle(to, n, supplyBefore);
        emit Exited(to, n, ethOut);
    }

    /// @notice RaisingClosed → Investing. The manager share must already be minted. Cannot reopen the raise.
    function enableInvesting() external {
        if (msg.sender != manager) revert NotManager();
        if (status != Status.RaisingClosed) revert NotClosed();
        IFundUnit unit = IFundUnit(nft);
        if (!unit.publicOpen() || unit.managerMinted() < unit.skinRequired()) revert SkinRequired();
        status = Status.Investing;
        investBlock = uint64(block.number);
        investTimestamp = uint64(block.timestamp);
        emit InvestingEnabled(mandateHash, nav());
    }

    function setExecutor(address who, bool allowed) external {
        if (msg.sender != manager) revert NotManager();
        if (who == address(0) || who == manager) revert BadExecutor();
        if (isExecutor[who] == allowed) return;
        if (allowed) {
            if (executorCount == MAX_EXECUTORS) revert TooMany();
            executorCount += 1;
        } else {
            executorCount -= 1;
        }
        isExecutor[who] = allowed;
        emit ExecutorSet(who, allowed);
    }

    /// @notice Immediate pause for swaps. Fee pulls are unchanged. Unpause is also immediate.
    function setSwapsPaused(bool next) external {
        if (msg.sender != manager) revert NotManager();
        swapsPaused = next;
        emit SwapsPaused(next);
    }

    /// @notice Swap through an allowlisted router, or wrap ETH ↔ WETH when `router` is the zero address.
    ///         `minAmountOut` must be non-zero. The body runs in the facet. Balances stay in this vault.
    function swap(address router, address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external
        nonReentrant
    {
        (bool ok, bytes memory ret) = swapFacet.delegatecall(
            abi.encodeWithSelector(FundSwapFacet.swap.selector, router, assetIn, assetOut, amountIn, minAmountOut, data)
        );
        if (!ok) _bubble(ret);
    }

    function claimableEntryFee() public view returns (uint256) {
        return entryFeeAccrued - entryFeeClaimed;
    }

    function claimableProtocolFee() public view returns (uint256) {
        return protocolFeeAccrued - protocolFeeClaimed;
    }

    function claimableFees() public view returns (uint256) {
        return claimableEntryFee() + claimableProtocolFee();
    }

    /// @notice ETH that swaps may spend. Unclaimed fees stay put.
    function spendableEth() public view returns (uint256) {
        uint256 fees = claimableFees();
        uint256 bal = address(this).balance;
        return bal <= fees ? 0 : bal - fees;
    }

    function mandateAssetCount() external view returns (uint256) {
        return _mandateAssets.length;
    }

    function mandateAssets(uint256 index) external view returns (address) {
        return _mandateAssets[index];
    }

    /// @notice Newest retained trade is offset 0. Older than `BLOT_CAP` are dropped from storage. Events remain.
    function blotter(uint256 offset) external view returns (TradeRecord memory) {
        if (offset >= tradeCount || offset >= BLOT_CAP) revert BadIndex();
        uint256 index = (tradeCount - 1 - offset) % BLOT_CAP;
        return trades[index];
    }

    /// @notice ETH + WETH at face value, plus mandate balances at the feed. Reverts on a bad price.
    ///         This includes unclaimed fees, because that ETH is still in the contract. It is not cost basis.
    function nav() public view returns (uint256) {
        return NAVReader.total(address(this).balance, IERC20(weth).balanceOf(address(this)), _mandateAssets, allowlist);
    }

    function navPerNft() public view returns (uint256) {
        uint256 live = nft == address(0) ? 0 : IFundUnit(nft).outstanding();
        return NAVReader.perNft(nav(), live);
    }

    /// @notice Custody, allowlist, skin, published source, and allowlist timelock. High-water mark is unset.
    ///         The source bit records that this code is published. It is not a review.
    function protectionBits() external view returns (uint8 bits, uint8 met, uint8 total) {
        bits = BIT_CUSTODY | BIT_ALLOWLIST | BIT_SOURCE;
        if (nft != address(0)) {
            IFundUnit unit = IFundUnit(nft);
            if (unit.publicOpen() && unit.managerMinted() >= unit.skinRequired()) bits |= BIT_SKIN;
        }
        if (allowlist.delay() >= 1 days) bits |= BIT_TIMELOCK;
        met = _popcount(bits);
        total = PROTECTION_TOTAL;
    }

    function withdrawEntryFee() external nonReentrant {
        if (msg.sender != manager) revert NotManager();
        uint256 amount = claimableEntryFee();
        if (amount == 0) revert NothingToWithdraw();
        entryFeeClaimed = entryFeeAccrued;
        emit EntryFeeWithdrawn(payoutWallet, amount);
        _send(payoutWallet, amount);
    }

    function withdrawProtocolFee() external nonReentrant {
        uint256 amount = claimableProtocolFee();
        if (amount == 0) revert NothingToWithdraw();
        address to = _feeRecipient();
        if (to == address(0)) revert ZeroAddress();
        protocolFeeClaimed = protocolFeeAccrued;
        emit ProtocolFeeWithdrawn(to, amount);
        _send(to, amount);
    }

    function setPayoutWallet(address wallet) external {
        if (msg.sender != manager) revert NotManager();
        if (wallet == address(0)) revert ZeroAddress();
        payoutWallet = wallet;
        emit PayoutWalletSet(wallet);
    }

    function _feeRecipient() internal view returns (address) {
        (bool ok, bytes memory data) = factory.staticcall(abi.encodeWithSignature("feeRecipient()"));
        if (!ok || data.length < 32) return address(0);
        return abi.decode(data, (address));
    }

    function _settle(address to, uint256 n, uint256 supplyBefore) internal returns (uint256 ethOut) {
        if (to == address(0) || n == 0 || supplyBefore == 0 || n > supplyBefore) revert BadAmount();
        if (IFundUnit(nft).outstanding() + n != supplyBefore) revert BadAmount();
        ethOut = _share(spendableEth(), n, supplyBefore);
        // Native ETH is paid first. A later token transfer that reverts is caught and does not undo this payment.
        _payEth(to, ethOut);
        _payToken(weth, to, n, supplyBefore);
        uint256 assets = _mandateAssets.length;
        for (uint256 i; i < assets; ++i) {
            _payToken(_mandateAssets[i], to, n, supplyBefore);
        }
        if (principal > ethOut) principal -= ethOut;
        else principal = 0;
    }

    function _share(uint256 pool, uint256 n, uint256 supplyBefore) internal pure returns (uint256) {
        if (pool == 0) return 0;
        if (n == supplyBefore) return pool;
        return (pool * n) / supplyBefore;
    }

    function _payEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (address(this).balance < amount + claimableFees()) revert FeesShort();
        _send(to, amount);
    }

    /// @notice Pull tokens that an exit reserved because the transfer did not complete.
    ///         A failed pull leaves the reservation in place. It does not move ETH.
    function claimOwed(address asset) external nonReentrant {
        uint256 amount = tokenOwed[msg.sender][asset];
        if (amount == 0) revert NothingToWithdraw();
        tokenOwed[msg.sender][asset] = 0;
        tokenReserved[asset] -= amount;
        if (!_deliver(asset, msg.sender, amount)) {
            tokenOwed[msg.sender][asset] = amount;
            tokenReserved[asset] += amount;
            revert TransferFailed();
        }
        emit TokenClaimed(msg.sender, asset, amount);
    }

    function _payToken(address token, address to, uint256 n, uint256 supplyBefore) internal {
        uint256 reserved = tokenReserved[token];
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 available = bal > reserved ? bal - reserved : 0;
        if (available == 0) return;
        uint256 out = _share(available, n, supplyBefore);
        if (out == 0) return;
        uint256 vaultBefore = IERC20(token).balanceOf(address(this));
        if (_deliver(token, to, out)) {
            _reduceBasis(token, out, available);
            return;
        }
        uint256 vaultAfter = IERC20(token).balanceOf(address(this));
        if (vaultAfter != vaultBefore) {
            // Tokens left the vault but the recipient did not receive `out` (for example a transfer tax).
            // Do not reserve them, and do not undo the ETH already sent. Those tokens are unsupported.
            uint256 gone = vaultBefore > vaultAfter ? vaultBefore - vaultAfter : 0;
            if (gone > 0) _reduceBasis(token, gone, available);
            return;
        }
        tokenOwed[to][token] += out;
        tokenReserved[token] += out;
        emit TokenOwed(to, token, out);
    }

    /// @dev True only when the vault lost `amount` and the recipient gained `amount`.
    ///      A revert, a false return, or a short delivery is a failure. Fee-on-transfer is not supported.
    function _deliver(address token, address to, uint256 amount) internal returns (bool) {
        uint256 vaultBefore = IERC20(token).balanceOf(address(this));
        uint256 holderBefore = IERC20(token).balanceOf(to);
        if (vaultBefore < amount) return false;
        try IERC20(token).transfer(to, amount) returns (bool ok) {
            if (!ok) return false;
        } catch {
            return false;
        }
        uint256 vaultAfter = IERC20(token).balanceOf(address(this));
        uint256 holderAfter = IERC20(token).balanceOf(to);
        if (holderAfter < holderBefore) return false;
        return vaultAfter == vaultBefore - amount && holderAfter - holderBefore == amount;
    }

    function _reduceBasis(address token, uint256 out, uint256 available) internal {
        uint256 basis = costBasis[token];
        if (basis == 0) return;
        uint256 removed = out == available ? basis : (basis * out) / available;
        if (removed > basis) removed = basis;
        costBasis[token] = basis - removed;
        totalCostBasis -= removed;
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _popcount(uint8 bits) internal pure returns (uint8 n) {
        uint8 x = bits;
        while (x != 0) {
            n += x & 1;
            x >>= 1;
        }
    }

    function _bubble(bytes memory ret) internal pure {
        if (ret.length == 0) revert SwapFailed();
        assembly {
            revert(add(ret, 32), mload(ret))
        }
    }
}
