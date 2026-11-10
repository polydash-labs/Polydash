// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundAllowlist} from "../phase2/Interfaces.sol";
import {FundNFTPhase3} from "./FundNFTPhase3.sol";
import {FundNFTPhase3Deployer} from "./FundPhase3Spawn.sol";
import {FundVaultPhase3V2Deployer} from "./FundPhase3V2Spawn.sol";
import {FundVaultPhase3V2} from "./FundVaultPhase3V2.sol";
import {StrategyTemplate} from "./StrategyTemplate.sol";

/// @title FundFactoryPhase3V2 (not reviewed, not deployed)
/// @notice Creates funds with the manager-proposed-assets mechanism (Option 3). A copy of
///         `FundFactoryPhase3` wiring the V2 vault deployer and the V2 swap facet; every
///         validation, constant, and the NFT deployer are unchanged. It reuses the live
///         allowlist, `StrategyTemplate`, WETH, and the existing NFT code, and it does not
///         call the live Phase 3 factory or change any live contract. Funds from this
///         factory are NOT recognized by the deployed Phase 5 modules (they take the live
///         factory as an immutable constructor arg and resolve vaults via
///         `Phase5Fund.vaultOf(factory, nft)`); a second `FundPhase5` deployment pointing
///         at this factory is the deployment follow-up that enables secondary listings,
///         conviction locks, NAV floor, carry, and the renderer for V2 funds.
///         This contract is not deployed. Not a review. Not financial advice.
contract FundFactoryPhase3V2 is ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant PROTOCOL_FEE_BPS = 20;
    uint256 public constant MAX_ENTRY_FEE_BPS = 500;
    uint256 public constant DEFAULT_MIN_SKIN_BPS = 500;
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MIN_MINT_PRICE = 0.00001 ether;
    uint256 public constant MAX_MINT_PRICE = 100 ether;
    uint256 public constant MIN_RAISE_DURATION = 1 hours;
    uint256 public constant MAX_RAISE_DURATION = 30 days;

    struct Params {
        uint256 templateId;
        string name;
        string symbol;
        string imageUri;
        string baseURI;
        uint256 mintPrice;
        uint256 raiseCap;
        uint256 entryFeeBps;
        uint256 minSkinBps;
        uint256 raiseDuration;
    }

    address public owner;
    address public pendingOwner;
    address public feeRecipient;
    IFundAllowlist public immutable allowlist;
    address public immutable weth;
    address public immutable swapFacet;
    StrategyTemplate public immutable templates;
    FundVaultPhase3V2Deployer public immutable vaultDeployer;
    FundNFTPhase3Deployer public immutable nftDeployer;

    address[] public allFunds;
    mapping(address => bool) public isFund;

    event FundCreated(
        address indexed fund, address indexed vault, address indexed manager, uint256 templateId, uint256 maxSupply
    );
    event FeeRecipientSet(address indexed recipient);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error InvalidParams();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _feeRecipient, address _allowlist, address _weth, address _swapFacet, address _templates) {
        if (
            _feeRecipient == address(0) || _allowlist == address(0) || _weth == address(0) || _swapFacet == address(0)
                || _templates == address(0)
        ) revert InvalidParams();
        if (_swapFacet.code.length == 0) revert InvalidParams();
        if (!IFundAllowlist(_allowlist).assetAllowed(_weth)) revert InvalidParams();
        owner = msg.sender;
        feeRecipient = _feeRecipient;
        allowlist = IFundAllowlist(_allowlist);
        weth = _weth;
        swapFacet = _swapFacet;
        templates = StrategyTemplate(_templates);
        vaultDeployer = new FundVaultPhase3V2Deployer();
        nftDeployer = new FundNFTPhase3Deployer();
        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientSet(_feeRecipient);
    }

    /// @notice The mandate, asset list, caps, performance fee, drawdown brake, and skin lock come from
    ///         the template. The manager cannot pass different values.
    function createFund(Params calldata p) external nonReentrant returns (address fund) {
        uint256 nameLen = bytes(p.name).length;
        uint256 symbolLen = bytes(p.symbol).length;
        if (nameLen == 0 || nameLen > 64 || symbolLen == 0 || symbolLen > 16) revert InvalidParams();
        if (bytes(p.imageUri).length > 512 || bytes(p.baseURI).length > 512) revert InvalidParams();
        if (p.mintPrice < MIN_MINT_PRICE || p.mintPrice > MAX_MINT_PRICE) revert InvalidParams();
        if (p.raiseCap < p.mintPrice || p.entryFeeBps > MAX_ENTRY_FEE_BPS) revert InvalidParams();
        if (p.raiseDuration < MIN_RAISE_DURATION || p.raiseDuration > MAX_RAISE_DURATION) revert InvalidParams();

        (
            bytes32 mandateHash,
            string memory mandateUri,
            uint256 maxPositionBps,
            uint256 maxTradeBps,
            uint256 maxDeviationBps,
            uint256 hwmFeeBps,
            uint256 maxDrawdownBps,
            uint64 skinLock
        ) = templates.getTemplate(p.templateId);
        address[] memory assets = templates.assetsOf(p.templateId);
        _checkAssets(assets);

        uint256 maxSupply = p.raiseCap / p.mintPrice;
        if (maxSupply == 0 || maxSupply > MAX_SUPPLY) revert InvalidParams();
        uint256 skinBps = p.minSkinBps == 0 ? DEFAULT_MIN_SKIN_BPS : p.minSkinBps;
        if (skinBps < DEFAULT_MIN_SKIN_BPS || skinBps > BPS) revert InvalidParams();
        uint256 skinRequired = (maxSupply * skinBps + BPS - 1) / BPS;
        if (skinRequired == 0 || skinRequired > maxSupply) revert InvalidParams();

        FundVaultPhase3V2 vault = vaultDeployer.deploy(
            msg.sender,
            p.raiseCap,
            maxSupply,
            p.entryFeeBps,
            PROTOCOL_FEE_BPS,
            address(allowlist),
            weth,
            mandateHash,
            assets,
            swapFacet,
            uint64(block.timestamp + p.raiseDuration),
            mandateUri,
            maxPositionBps,
            maxTradeBps,
            maxDeviationBps,
            p.templateId,
            hwmFeeBps,
            maxDrawdownBps
        );
        FundNFTPhase3 nft = nftDeployer.deploy(
            FundNFTPhase3.Init({
                name: p.name,
                symbol: p.symbol,
                imageUri: p.imageUri,
                baseURI: p.baseURI,
                manager: msg.sender,
                vault: address(vault),
                factory: address(this),
                mintPrice: p.mintPrice,
                maxSupply: maxSupply,
                entryFeeBps: p.entryFeeBps,
                protocolFeeBps: PROTOCOL_FEE_BPS,
                minSkinBps: skinBps,
                skinRequired: skinRequired,
                skinUnlockTime: uint64(block.timestamp + skinLock)
            })
        );
        vault.bind(address(nft));
        fund = address(nft);
        allFunds.push(fund);
        isFund[fund] = true;
        emit FundCreated(fund, address(vault), msg.sender, p.templateId, maxSupply);
    }

    function allFundsLength() external view returns (uint256) {
        return allFunds.length;
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidParams();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert InvalidParams();
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function _checkAssets(address[] memory assets) internal view {
        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            if (asset == address(0) || asset == weth || asset == address(allowlist)) revert InvalidParams();
            if (!allowlist.assetAllowed(asset)) revert InvalidParams();
            (address feed,,,) = allowlist.feedOf(asset);
            if (feed == address(0)) revert InvalidParams();
        }
    }
}
