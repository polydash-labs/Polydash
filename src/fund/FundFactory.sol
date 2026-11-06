// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FundNFT} from "./FundNFT.sol";
import {FundVault} from "./FundVault.sol";

/// @title FundFactory (DRAFT - not reviewed, not deployed)
/// @notice Permissionless factory for Phase 1a tokenized funds. Anyone can create a fund.
///         Each fund is a new FundVault plus a new FundNFT, deployed with `new` (the same
///         style as the staking, vesting, bond, and NFT staking factories). No proxies.
///         The owner can change the protocol fee recipient and transfer ownership.
///         The owner cannot move ETH out of a vault.
/// @dev maxSupply is raiseCap / mintPrice, rounded down. raiseCap % mintPrice wei cannot
///      buy another NFT (no partial unit). When maxSupply is minted, raised ETH is
///      maxSupply * mintPrice, which is less than or equal to raiseCap.
contract FundFactory is ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    /// @notice Protocol fee on mint ETH. Same 0.2% as the launchpad platform fee. No setter.
    uint256 public constant PROTOCOL_FEE_BPS = 20;
    /// @notice Manager entry fee cap. Same 5% cap as the launchpad creator fee.
    uint256 public constant MAX_ENTRY_FEE_BPS = 500;
    /// @notice Default and minimum manager mint, 5% of maxSupply, rounded up.
    uint256 public constant DEFAULT_MIN_SKIN_BPS = 500;
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MIN_MINT_PRICE = 0.00001 ether;
    uint256 public constant MAX_MINT_PRICE = 100 ether;

    struct Params {
        string name;
        string symbol;
        string imageUri;
        string baseURI;
        uint256 mintPrice;
        uint256 raiseCap;
        uint256 entryFeeBps; // 0..500
        uint256 minSkinBps; // 0 = default 500; otherwise 500..10_000
    }

    address public owner;
    address public pendingOwner;
    address public feeRecipient;

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
        uint256 entryFeeBps,
        uint256 minSkinBps,
        uint256 skinRequired
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

    constructor(address _feeRecipient) {
        if (_feeRecipient == address(0)) revert InvalidParams();
        owner = msg.sender;
        feeRecipient = _feeRecipient;
        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientSet(_feeRecipient);
    }

    /// @notice maxSupply and the wei that cannot mint another NFT.
    function previewSupply(uint256 raiseCap, uint256 mintPrice) external pure returns (uint256 maxSupply, uint256 dust) {
        if (mintPrice == 0) revert InvalidParams();
        maxSupply = raiseCap / mintPrice;
        dust = raiseCap % mintPrice;
    }

    /// @notice Deploy a vault and an NFT collection. The caller is the manager.
    ///         Public mint stays closed until the manager mints `skinRequired` units at mintPrice.
    function createFund(Params calldata p) external nonReentrant returns (address fund) {
        uint256 nameLen = bytes(p.name).length;
        uint256 symbolLen = bytes(p.symbol).length;
        if (nameLen == 0 || nameLen > 64 || symbolLen == 0 || symbolLen > 16) revert InvalidParams();
        if (bytes(p.imageUri).length > 512 || bytes(p.baseURI).length > 512) revert InvalidParams();
        if (p.mintPrice < MIN_MINT_PRICE || p.mintPrice > MAX_MINT_PRICE) revert InvalidParams();
        if (p.raiseCap < p.mintPrice || p.entryFeeBps > MAX_ENTRY_FEE_BPS) revert InvalidParams();

        uint256 maxSupply = p.raiseCap / p.mintPrice;
        if (maxSupply == 0 || maxSupply > MAX_SUPPLY) revert InvalidParams();

        uint256 skinBps = p.minSkinBps == 0 ? DEFAULT_MIN_SKIN_BPS : p.minSkinBps;
        if (skinBps < DEFAULT_MIN_SKIN_BPS || skinBps > BPS) revert InvalidParams();
        uint256 skinRequired = (maxSupply * skinBps + BPS - 1) / BPS;
        if (skinRequired == 0 || skinRequired > maxSupply) revert InvalidParams();

        FundVault vault = new FundVault(msg.sender, p.raiseCap, maxSupply, p.entryFeeBps, PROTOCOL_FEE_BPS);
        FundNFT nft = new FundNFT(
            FundNFT.Init({
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

        emit FundCreated(
            fund, address(vault), msg.sender, p.mintPrice, p.raiseCap, maxSupply, p.entryFeeBps, skinBps, skinRequired
        );
    }

    function allFundsLength() external view returns (uint256) {
        return allFunds.length;
    }

    function fundsByManager(address manager) external view returns (address[] memory) {
        return _byManager[manager];
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidParams();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidParams();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
