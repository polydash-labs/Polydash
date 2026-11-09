// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundAllowlist, IFundUnit} from "../phase2/Interfaces.sol";
import {NAVReader} from "../phase2/NAVReader.sol";
import {FundVaultStore} from "../phase2/FundVaultStore.sol";
import {FundPhase3Store} from "./FundPhase3Store.sol";
import {FundSwapFacetPhase3} from "./FundSwapFacetPhase3.sol";

interface IPhase3NFT {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title FundVaultPhase3
/// @notice New vault for a fund created from a locked strategy template. It does not replace a live
///         Phase 2 vault. The swap body is `FundSwapFacetPhase3`, not the live facet.
///         Net NAV excludes entry, protocol, and performance fees, and ETH reserved for a distribution.
///         A high-water-mark fee accrues on the gain in net NAV per NFT. A drawdown brake blocks new
///         buys of mandate assets. There is no function that sends principal to the manager.
///         This contract is not deployed. Not a review. Not financial advice.
contract FundVaultPhase3 is ReentrancyGuard, FundVaultStore, FundPhase3Store {
    address public immutable swapFacet;
    /// @notice Where the mandate text lives (ipfs:// or https://). Stored at creation with the hash,
    ///         so LPs can read the mandate the hash commits to. Declared here, not in the shared store,
    ///         because the swap facet never reads it.
    string public mandateUri;

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
        address _factory,
        string memory _mandateUri,
        uint256 _maxPositionBps,
        uint256 _maxTradeBps,
        uint256 _maxDeviationBps,
        uint256 _templateId,
        uint256 _hwmFeeBps,
        uint256 _maxDrawdownBps
    ) {
        if (
            _manager == address(0) || _allowlist == address(0) || _weth == address(0) || _swapFacet == address(0)
                || _factory == address(0)
        ) revert ZeroAddress();
        if (_swapFacet.code.length == 0) revert BadRouter();
        if (_mandateHash == bytes32(0) || _raiseDeadline <= block.timestamp) revert BadValue();
        if (bytes(_mandateUri).length == 0 || bytes(_mandateUri).length > 512) revert BadUri();
        if (_maxPositionBps > BPS || _maxTradeBps > BPS || _maxDeviationBps > BPS) revert BadValue();
        if (_templateId == 0 || _hwmFeeBps > BPS || _maxDrawdownBps > BPS) revert BadValue();
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
        mandateUri = _mandateUri;
        maxPositionBps = _maxPositionBps == 0 ? DEFAULT_MAX_POSITION_BPS : _maxPositionBps;
        maxTradeBps = _maxTradeBps == 0 ? DEFAULT_MAX_TRADE_BPS : _maxTradeBps;
        maxDeviationBps = _maxDeviationBps == 0 ? DEFAULT_MAX_DEVIATION_BPS : _maxDeviationBps;
        universeHash = keccak256(abi.encode(assets));
        payoutWallet = _manager;
        raiseDeadline = _raiseDeadline;
        status = Status.Raising;
        templateId = _templateId;
        hwmFeeBps = _hwmFeeBps;
        maxDrawdownBps = _maxDrawdownBps;
        emit MandatePublished(_mandateHash, _mandateUri);
        emit PositionCapsSet(maxPositionBps, maxTradeBps, maxDeviationBps);

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
        uint256 per = navPerNft();
        hwmPerNft = per;
        peakNavPerNft = per;
        emit InvestingEnabled(mandateHash, nav());
        _tape();
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
        bool buyingRisk = assetOut != address(0) && assetOut != weth;
        uint256 drop = _drawdownBps();
        if (buyingRisk && maxDrawdownBps != 0 && drop >= maxDrawdownBps) {
            emit DrawdownBrake(drop);
            revert DrawdownBrakeActive();
        }
        (bool ok, bytes memory ret) = swapFacet.delegatecall(
            abi.encodeWithSelector(
                FundSwapFacetPhase3.swap.selector, router, assetIn, assetOut, amountIn, minAmountOut, data
            )
        );
        if (!ok) _bubble(ret);
        _pokePeak();
        _tape();
    }

    /// @notice Accrue a performance fee on the gain in net NAV per NFT since `hwmPerNft`.
    ///         The fee stays in the vault until the manager pulls it. It is not principal.
    function harvest() external nonReentrant returns (uint256 fee) {
        fee = _crystallize();
    }

    /// @notice Set aside `amount` of spendable ETH for the current holders, one share per outstanding NFT.
    ///         Dust below one wei per NFT is not reserved. The manager does not receive a share from this call.
    function distribute(uint256 amount) external nonReentrant returns (uint256 roundId) {
        if (msg.sender != manager) revert NotManager();
        if (status != Status.Investing && status != Status.RaisingClosed) revert NotExitable();
        _crystallize();
        uint256 supply = nft == address(0) ? 0 : IFundUnit(nft).outstanding();
        if (amount == 0 || supply == 0 || amount > spendableEth()) revert BadAmount();
        uint256 per = amount / supply;
        if (per == 0) revert BadAmount();
        uint256 pot = per * supply;
        distributionReserved += pot;
        roundId = ++distRound;
        rounds[roundId] = DistRound({perUnit: per, pot: pot});
        emit Distributed(roundId, pot, per);
    }

    /// @notice Holders pull every unclaimed round for the NFTs they still hold.
    function claim(uint256[] calldata ids) external nonReentrant returns (uint256 paid) {
        paid = _pull(msg.sender, ids);
    }

    /// @notice Called by the NFT before it burns, so an exit does not strand a round.
    function claimAll(address to, uint256[] calldata ids) external nonReentrant onlyNft returns (uint256 paid) {
        paid = _pull(to, ids);
    }

    function withdrawPerformanceFee() external nonReentrant {
        if (msg.sender != manager) revert NotManager();
        uint256 amount = performanceFeeAccrued - performanceFeeClaimed;
        if (amount == 0) revert NothingToWithdraw();
        performanceFeeClaimed = performanceFeeAccrued;
        emit PerformanceFeeWithdrawn(payoutWallet, amount);
        _send(payoutWallet, amount);
    }

    function claimableEntryFee() public view returns (uint256) {
        return entryFeeAccrued - entryFeeClaimed;
    }

    function claimableProtocolFee() public view returns (uint256) {
        return protocolFeeAccrued - protocolFeeClaimed;
    }

    function claimablePerformanceFee() public view returns (uint256) {
        return performanceFeeAccrued - performanceFeeClaimed;
    }

    /// @notice Entry, protocol, and performance fees, plus ETH already assigned to a distribution round.
    function reservedEth() public view returns (uint256) {
        return claimableEntryFee() + claimableProtocolFee() + claimablePerformanceFee() + distributionReserved;
    }

    function claimableFees() public view returns (uint256) {
        return reservedEth();
    }

    /// @notice ETH that swaps and a new distribution may spend. Reserved amounts stay put.
    function spendableEth() public view returns (uint256) {
        uint256 fees = reservedEth();
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

    /// @notice ETH + WETH at face value, plus mandate balances at the feed, minus unclaimed fees.
    ///         Fees are still in the contract, but they belong to the manager / protocol, not the LPs.
    ///         Reverts on a bad price. This is what `navPerNft()` divides, and what an exit is worth.
    function nav() public view returns (uint256) {
        return NAVReader.netTotal(
            address(this).balance, IERC20(weth).balanceOf(address(this)), _mandateAssets, allowlist, reservedEth()
        );
    }

    function navPerNft() public view returns (uint256) {
        uint256 live = nft == address(0) ? 0 : IFundUnit(nft).outstanding();
        return NAVReader.perNft(nav(), live);
    }

    /// @notice Permissionless hourly NAV checkpoint. Anyone may call it once `NAV_CHECKPOINT_INTERVAL`
    ///         has passed since the last checkpoint. It records the fee-excluded NAV per NFT and emits
    ///         `NavCheckpoint`, so the tape has an hourly point even when nobody trades. The blotter
    ///         still records `navAfter` on every trade. Reverts when a feed cannot be used, same
    ///         fail-closed rule as `nav()`; the keeper just retries later.
    /// @notice Permissionless hourly NAV tape. The first checkpoint is always allowed
    ///         (`lastNavCheckpoint == 0` means "never checkpointed"); afterwards at least
    ///         `NAV_CHECKPOINT_INTERVAL` must pass. Reverts when a feed cannot be used, same
    ///         fail-closed rule as `nav()`.
    function checkpointNav() external {
        if (lastNavCheckpoint != 0 && block.timestamp < uint256(lastNavCheckpoint) + NAV_CHECKPOINT_INTERVAL) {
            revert TooSoon();
        }
        _pokePeak();
        uint256 total = nav();
        uint256 perNft = navPerNft();
        lastNavCheckpoint = uint64(block.timestamp);
        lastCheckpointNavPerNft = perNft;
        emit NavCheckpoint(uint64(block.timestamp), total, perNft);
        _tape();
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

    function _crystallize() internal returns (uint256 fee) {
        if (status != Status.Investing && status != Status.RaisingClosed) return 0;
        uint256 outstanding = nft == address(0) ? 0 : IFundUnit(nft).outstanding();
        if (outstanding == 0 || hwmFeeBps == 0) return 0;
        uint256 per = navPerNft();
        if (hwmPerNft == 0) {
            hwmPerNft = per;
            return 0;
        }
        if (per <= hwmPerNft) return 0;
        uint256 gain = (per - hwmPerNft) * outstanding;
        fee = (gain * hwmFeeBps) / BPS;
        uint256 room = spendableEth();
        if (fee > room) fee = room;
        if (fee == 0) return 0;
        performanceFeeAccrued += fee;
        hwmPerNft = navPerNft();
        emit PerformanceFeeAccrued(fee, hwmPerNft);
    }

    function _drawdownBps() internal view returns (uint256) {
        if (peakNavPerNft == 0) return 0;
        uint256 per = navPerNft();
        if (per >= peakNavPerNft) return 0;
        return ((peakNavPerNft - per) * BPS) / peakNavPerNft;
    }

    function _pokePeak() internal {
        uint256 per = navPerNft();
        if (per > peakNavPerNft) peakNavPerNft = per;
    }

    function _tape() internal {
        emit NavTape(uint64(block.timestamp), nav(), navPerNft(), hwmPerNft, _drawdownBps());
    }

    function _pull(address to, uint256[] calldata ids) internal returns (uint256 paid) {
        if (to == address(0) || ids.length == 0) revert BadAmount();
        uint256 roundsN = distRound;
        for (uint256 r = 1; r <= roundsN; ++r) {
            uint256 per = rounds[r].perUnit;
            if (per == 0) continue;
            uint256 count = 0;
            for (uint256 i; i < ids.length; ++i) {
                if (IPhase3NFT(nft).ownerOf(ids[i]) != to) revert BadAmount();
                if (distributionClaimed[r][ids[i]]) continue;
                distributionClaimed[r][ids[i]] = true;
                count += 1;
            }
            paid += per * count;
        }
        if (paid == 0) return 0;
        if (paid > distributionReserved) revert BadAmount();
        distributionReserved -= paid;
        emit DistributionClaimed(to, paid);
        _send(to, paid);
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
            // Tokens left the vault without the holder receiving `out`. Revert so the burn and the
            // ETH already staged in this call do not settle. A supported token has to deliver in full.
            revert UnsupportedToken();
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
