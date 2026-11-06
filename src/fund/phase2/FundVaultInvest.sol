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
///         Status moves Raising → RaisingClosed → Investing. Principal has no withdraw function.
///         After Investing, the manager or an executor can swap through an allowlisted router.
///         The swap body lives in `FundSwapFacet` and runs by delegatecall, so the funds stay here.
///         One side of a swap is ETH or WETH. The other side is in this fund's mandate and on the global allowlist.
///         ETH ↔ WETH is a direct wrap, with no router. Proceeds are measured on this contract.
///         `nav()` is ETH plus WETH plus the quote spent on other allowlisted assets. It is not a market price.
///         There is no price feed. Holdings outside ETH and WETH stay at the quote that was spent.
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
        address _swapFacet
    ) {
        if (_manager == address(0) || _allowlist == address(0) || _weth == address(0) || _swapFacet == address(0)) {
            revert ZeroAddress();
        }
        if (_swapFacet.code.length == 0) revert BadRouter();
        if (_mandateHash == bytes32(0)) revert BadValue();
        if (assets.length > MAX_ASSETS) revert TooMany();
        if (!IFundAllowlist(_allowlist).assetAllowed(_weth)) revert NotAllowlisted();

        swapFacet = _swapFacet;
        factory = msg.sender;
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
        if (raised >= raiseCap || minted >= maxSupply) {
            status = Status.RaisingClosed;
            emit RaiseClosed(raised, minted);
        }
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

    /// @notice ETH balance + WETH balance + quote spent on mandate assets. Not a market price.
    function nav() public view returns (uint256) {
        return NAVReader.total(address(this).balance, IERC20(weth).balanceOf(address(this)), totalCostBasis);
    }

    function navPerNft() public view returns (uint256) {
        uint256 minted = nft == address(0) ? 0 : IFundUnit(nft).totalMinted();
        return NAVReader.perNft(nav(), minted);
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
