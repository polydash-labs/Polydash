// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundAllowlistV2, IFundOracleV2, IFundUnitV2} from "./Interfaces.sol";
import {FundSwapFacetV2} from "./FundSwapFacetV2.sol";
import {FundV2Store} from "./FundV2Store.sol";

/// @title FundVaultV2 (not reviewed, not deployed)
/// @notice Phase 2 v2 vault. Phase 1 and the deployed Phase 2 v1 factory are different contracts.
///         A missed deadline refunds each unit at `mintPrice`. Fees stay in the vault until the target is met.
///         After a wind-down, holders redeem a pro-rata share of the assets. Nothing sends principal to the manager.
///         `nav()` is ETH plus WETH at face value. `totalCostBasis` is accounting, not a market price.
///         `oracle` starts unset. It is not an input to `nav()`.
contract FundVaultV2 is ReentrancyGuard, FundV2Store {
    using SafeERC20 for IERC20;

    address public immutable swapFacet;

    modifier onlyNft() {
        if (msg.sender != nft || nft == address(0)) revert NotNft();
        _;
    }

    constructor(
        address _manager,
        uint256 _raiseCap,
        uint256 _maxSupply,
        uint256 _mintPrice,
        uint256 _entryFeeBps,
        uint256 _protocolFeeBps,
        uint64 _raiseDeadline,
        address _allowlist,
        address _weth,
        bytes32 _mandateHash,
        address[] memory assets,
        address _swapFacet,
        address _factory
    ) {
        if (_manager == address(0) || _allowlist == address(0) || _weth == address(0) || _swapFacet == address(0) || _factory == address(0)) {
            revert ZeroAddress();
        }
        if (_swapFacet.code.length == 0) revert BadRouter();
        if (_mandateHash == bytes32(0) || _raiseDeadline <= block.timestamp) revert BadValue();
        if (assets.length > MAX_ASSETS) revert TooMany();
        if (!IFundAllowlistV2(_allowlist).assetAllowed(_weth)) revert NotAllowlisted();
        swapFacet = _swapFacet;
        factory = _factory;
        manager = _manager;
        raiseCap = _raiseCap;
        maxSupply = _maxSupply;
        mintPrice = _mintPrice;
        entryFeeBps = _entryFeeBps;
        protocolFeeBps = _protocolFeeBps;
        raiseDeadline = _raiseDeadline;
        allowlist = IFundAllowlistV2(_allowlist);
        weth = _weth;
        mandateHash = _mandateHash;
        universeHash = keccak256(abi.encode(assets));
        payoutWallet = _manager;
        status = Status.Raising;
        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            if (asset == address(0) || asset == _weth || asset == _allowlist) revert BadPair();
            if (inMandate[asset]) revert BadPair();
            if (!IFundAllowlistV2(_allowlist).assetAllowed(asset)) revert NotAllowlisted();
            inMandate[asset] = true;
            _mandateAssets.push(asset);
        }
    }

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
        if (status != Status.Raising || block.timestamp > raiseDeadline) revert NotRaising();
        uint256 expectEntry = (msg.value * entryFeeBps) / BPS;
        uint256 expectProtocol = (msg.value * protocolFeeBps) / BPS;
        if (entryFee != expectEntry || protocolFee != expectProtocol) revert BadValue();
        raised += msg.value;
        principal += msg.value - entryFee - protocolFee;
        entryFeeAccrued += entryFee;
        protocolFeeAccrued += protocolFee;
        emit Deposited(msg.value, msg.value - entryFee - protocolFee, entryFee, protocolFee);
    }

    function closeIfReady(uint256 minted) external onlyNft {
        if (status != Status.Raising || block.timestamp > raiseDeadline) return;
        if (raised >= raiseCap || minted >= maxSupply) {
            status = Status.RaisingClosed;
            emit RaiseClosed(raised, minted);
        }
    }

    /// @notice After the deadline, a short raise becomes `Failed`. A filled raise becomes `RaisingClosed`.
    function settleRaise() external {
        if (status != Status.Raising) revert NotRaising();
        if (block.timestamp <= raiseDeadline) revert RaiseOpen();
        uint256 minted = IFundUnitV2(nft).totalMinted();
        if (raised >= raiseCap || minted >= maxSupply) {
            status = Status.RaisingClosed;
            emit RaiseClosed(raised, minted);
            return;
        }
        status = Status.Failed;
        emit RaiseFailed(raised, minted);
    }

    /// @notice Failed raise. Pays `mintPrice` per burned unit to the current holder. Fees stay put.
    function payRefund(address to, uint256 count) external nonReentrant onlyNft {
        if (status != Status.Failed) revert NotFailed();
        if (to == address(0) || count == 0) revert BadAmount();
        uint256 ethOut = mintPrice * count;
        emit Refunded(to, count, ethOut);
        _send(to, ethOut);
    }

    /// @notice Stop swaps and open pro-rata redemption. Only the manager. Does not take a share.
    function startWindDown() external {
        if (msg.sender != manager) revert NotManager();
        if (status != Status.RaisingClosed && status != Status.Investing) revert NotClosed();
        status = Status.WindingDown;
        swapsPaused = true;
        emit WindDownStarted(uint64(block.timestamp));
    }

    /// @notice Pro-rata ETH, WETH, and mandate tokens. The last outstanding units take the remainder.
    function payRedeem(address to, uint256 count, uint256 supplyBefore) external nonReentrant onlyNft {
        if (status != Status.WindingDown) revert NotWinding();
        if (to == address(0) || count == 0 || supplyBefore == 0 || count > supplyBefore) revert BadAmount();
        uint256 ethOut = count == supplyBefore ? address(this).balance : address(this).balance * count / supplyBefore;
        uint256 wethBal = IERC20(weth).balanceOf(address(this));
        uint256 wethOut = count == supplyBefore ? wethBal : wethBal * count / supplyBefore;
        uint256 n = _mandateAssets.length;
        uint256[] memory tokenOut = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            uint256 bal = IERC20(_mandateAssets[i]).balanceOf(address(this));
            tokenOut[i] = count == supplyBefore ? bal : bal * count / supplyBefore;
        }
        if (wethOut > 0) IERC20(weth).safeTransfer(to, wethOut);
        for (uint256 i; i < n; ++i) {
            if (tokenOut[i] == 0) continue;
            address asset = _mandateAssets[i];
            uint256 before = IERC20(asset).balanceOf(to);
            IERC20(asset).safeTransfer(to, tokenOut[i]);
            if (IERC20(asset).balanceOf(to) - before != tokenOut[i]) revert UnsupportedToken();
        }
        emit Redeemed(to, count, ethOut);
        if (ethOut > 0) _send(to, ethOut);
    }

    function enableInvesting() external {
        if (msg.sender != manager) revert NotManager();
        if (status != Status.RaisingClosed) revert NotClosed();
        IFundUnitV2 unit = IFundUnitV2(nft);
        if (!unit.publicOpen() || unit.managerMinted() < unit.skinRequired()) revert SkinRequired();
        status = Status.Investing;
        investBlock = uint64(block.number);
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

    function setSwapsPaused(bool next) external {
        if (msg.sender != manager) revert NotManager();
        if (status == Status.WindingDown) revert NotWinding();
        swapsPaused = next;
        emit SwapsPaused(next);
    }

    /// @notice Optional. The zero address disables it. `nav()` does not read this.
    function setOracle(address next) external {
        if (msg.sender != manager) revert NotManager();
        oracle = next;
        emit OracleSet(next);
    }

    function swap(address router, address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external
        nonReentrant
    {
        (bool ok, bytes memory ret) = swapFacet.delegatecall(
            abi.encodeWithSelector(FundSwapFacetV2.swap.selector, router, assetIn, assetOut, amountIn, minAmountOut, data)
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

    function blotter(uint256 offset) external view returns (TradeRecord memory) {
        if (offset >= tradeCount || offset >= BLOT_CAP) revert BadIndex();
        return trades[(tradeCount - 1 - offset) % BLOT_CAP];
    }

    /// @notice ETH plus WETH at face value. Not cost basis and not an oracle price.
    function nav() public view returns (uint256) {
        return address(this).balance + IERC20(weth).balanceOf(address(this));
    }

    function navPerNft() public view returns (uint256) {
        uint256 live = nft == address(0) ? 0 : IFundUnitV2(nft).outstanding();
        if (live == 0) return 0;
        return nav() / live;
    }

    /// @notice Off unless `oracle` is set. A stale or zero answer contributes nothing. Cost basis is not used.
    function indicatedQuote(address asset, uint256 balance) external view returns (uint256 quote, bool live) {
        if (oracle == address(0) || balance == 0 || asset == address(0)) return (0, false);
        try IFundOracleV2(oracle).price(asset) returns (uint256 perWad, uint256 updatedAt) {
            if (perWad == 0 || updatedAt == 0 || block.timestamp > updatedAt + ORACLE_STALE) return (0, false);
            return (balance * perWad / 1e18, true);
        } catch {
            return (0, false);
        }
    }

    function withdrawEntryFee() external nonReentrant {
        if (msg.sender != manager) revert NotManager();
        if (status != Status.RaisingClosed && status != Status.Investing) revert FeesLocked();
        uint256 amount = claimableEntryFee();
        if (amount == 0) revert NothingToWithdraw();
        entryFeeClaimed = entryFeeAccrued;
        emit EntryFeeWithdrawn(payoutWallet, amount);
        _send(payoutWallet, amount);
    }

    function withdrawProtocolFee() external nonReentrant {
        if (status != Status.RaisingClosed && status != Status.Investing) revert FeesLocked();
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

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _bubble(bytes memory ret) internal pure {
        if (ret.length == 0) revert SwapFailed();
        assembly {
            revert(add(ret, 32), mload(ret))
        }
    }
}
