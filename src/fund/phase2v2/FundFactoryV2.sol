// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundAllowlistV2} from "./Interfaces.sol";
import {FundNFTV2} from "./FundNFTV2.sol";
import {FundNFTV2Deployer, FundVaultV2Deployer} from "./FundV2Spawn.sol";
import {FundVaultV2} from "./FundVaultV2.sol";

/// @title FundFactoryV2 (not reviewed, not deployed)
/// @notice New factory for Phase 2 v2. It does not replace Phase 1 `0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878`
///         or the deployed Phase 2 v1 factory. The owner cannot move vault ETH.
contract FundFactoryV2 is ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant PROTOCOL_FEE_BPS = 20;
    uint256 public constant MAX_ENTRY_FEE_BPS = 500;
    uint256 public constant DEFAULT_MIN_SKIN_BPS = 500;
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MIN_MINT_PRICE = 0.00001 ether;
    uint256 public constant MAX_MINT_PRICE = 100 ether;
    uint256 public constant MAX_ASSETS = 16;
    uint256 public constant MIN_RAISE = 1 days;
    uint256 public constant MAX_RAISE = 90 days;

    struct Params {
        string name;
        string symbol;
        string imageUri;
        string baseURI;
        uint256 mintPrice;
        uint256 raiseCap;
        uint256 entryFeeBps;
        uint256 minSkinBps;
        uint256 raiseDuration;
        bytes32 mandateHash;
        address[] assets;
    }

    address public owner;
    address public pendingOwner;
    address public feeRecipient;
    IFundAllowlistV2 public immutable allowlist;
    address public immutable weth;
    address public immutable swapFacet;
    FundVaultV2Deployer public immutable vaultDeployer;
    FundNFTV2Deployer public immutable nftDeployer;
    address[] public allFunds;
    mapping(address => bool) public isFund;
    mapping(address => bool) public isVault;
    mapping(address => address[]) internal _byManager;

    event FundCreated(
        address indexed fund,
        address indexed vault,
        address indexed manager,
        uint256 mintPrice,
        uint256 raiseCap,
        uint256 maxSupply,
        uint64 raiseDeadline,
        bytes32 mandateHash
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

    constructor(address _feeRecipient, address _allowlist, address _weth, address _swapFacet) {
        if (_feeRecipient == address(0) || _allowlist == address(0) || _weth == address(0) || _swapFacet == address(0)) {
            revert InvalidParams();
        }
        if (_swapFacet.code.length == 0) revert InvalidParams();
        if (!IFundAllowlistV2(_allowlist).assetAllowed(_weth)) revert InvalidParams();
        owner = msg.sender;
        feeRecipient = _feeRecipient;
        allowlist = IFundAllowlistV2(_allowlist);
        weth = _weth;
        swapFacet = _swapFacet;
        vaultDeployer = new FundVaultV2Deployer();
        nftDeployer = new FundNFTV2Deployer();
        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientSet(_feeRecipient);
    }

    function createFund(Params calldata p) external nonReentrant returns (address fund) {
        uint256 nameLen = bytes(p.name).length;
        uint256 symbolLen = bytes(p.symbol).length;
        if (nameLen == 0 || nameLen > 64 || symbolLen == 0 || symbolLen > 16) revert InvalidParams();
        if (bytes(p.imageUri).length > 512 || bytes(p.baseURI).length > 512) revert InvalidParams();
        if (p.mintPrice < MIN_MINT_PRICE || p.mintPrice > MAX_MINT_PRICE) revert InvalidParams();
        if (p.raiseCap < p.mintPrice || p.entryFeeBps > MAX_ENTRY_FEE_BPS) revert InvalidParams();
        if (p.raiseDuration < MIN_RAISE || p.raiseDuration > MAX_RAISE) revert InvalidParams();
        if (p.mandateHash == bytes32(0) || p.assets.length > MAX_ASSETS) revert InvalidParams();
        uint256 maxSupply = p.raiseCap / p.mintPrice;
        if (maxSupply == 0 || maxSupply > MAX_SUPPLY) revert InvalidParams();
        uint256 skinBps = p.minSkinBps == 0 ? DEFAULT_MIN_SKIN_BPS : p.minSkinBps;
        if (skinBps < DEFAULT_MIN_SKIN_BPS || skinBps > BPS) revert InvalidParams();
        uint256 skinRequired = (maxSupply * skinBps + BPS - 1) / BPS;
        if (skinRequired == 0 || skinRequired > maxSupply) revert InvalidParams();
        _checkAssets(p.assets);
        uint64 deadline = uint64(block.timestamp + p.raiseDuration);
        FundVaultV2 vault = vaultDeployer.deploy(
            msg.sender,
            p.raiseCap,
            maxSupply,
            p.mintPrice,
            p.entryFeeBps,
            PROTOCOL_FEE_BPS,
            deadline,
            address(allowlist),
            weth,
            p.mandateHash,
            p.assets,
            swapFacet
        );
        FundNFTV2 nft = nftDeployer.deploy(
            FundNFTV2.Init({
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
                skinRequired: skinRequired
            })
        );
        vault.bind(address(nft));
        fund = address(nft);
        allFunds.push(fund);
        isFund[fund] = true;
        isVault[address(vault)] = true;
        _byManager[msg.sender].push(fund);
        emit FundCreated(fund, address(vault), msg.sender, p.mintPrice, p.raiseCap, maxSupply, deadline, p.mandateHash);
    }

    function allFundsLength() external view returns (uint256) {
        return allFunds.length;
    }

    function fundsByManager(address who) external view returns (address[] memory) {
        return _byManager[who];
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

    function _checkAssets(address[] calldata assets) internal view {
        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            if (asset == address(0) || asset == weth || asset == address(allowlist)) revert InvalidParams();
            if (!allowlist.assetAllowed(asset)) revert InvalidParams();
            for (uint256 j; j < i; ++j) if (assets[j] == asset) revert InvalidParams();
        }
    }
}
