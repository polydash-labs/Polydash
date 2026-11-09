// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundAllowlist} from "./Interfaces.sol";
import {FundNFTInvest} from "./FundNFTInvest.sol";
import {FundNFTDeployer, FundVaultDeployer} from "./FundSpawn.sol";
import {FundVaultInvest} from "./FundVaultInvest.sol";

/// @title FundFactoryInvest (not reviewed, not deployed)
/// @notice Deploys one investing vault and one NFT per fund. This is not the live Phase 1a factory.
///         Phase 1a `FundFactory` at 0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878 is unchanged.
///         There is no proxy. The vault and NFT are still created with `new`, from two deployer
///         contracts, so this factory's runtime stays under the 24576-byte limit.
///         The owner can change the fee recipient. The owner cannot move ETH out of a vault.
contract FundFactoryInvest is ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant PROTOCOL_FEE_BPS = 20;
    uint256 public constant MAX_ENTRY_FEE_BPS = 500;
    uint256 public constant DEFAULT_MIN_SKIN_BPS = 500;
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MIN_MINT_PRICE = 0.00001 ether;
    uint256 public constant MAX_MINT_PRICE = 100 ether;
    uint256 public constant MAX_ASSETS = 16;
    uint256 public constant MIN_RAISE_DURATION = 1 hours;
    uint256 public constant MAX_RAISE_DURATION = 30 days;

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
        /// @notice Where the mandate text lives (ipfs:// or https://). Required: the hash alone does
        ///         not let LPs read the mandate. Emitted in `MandatePublished` and stored on the vault.
        string mandateUri;
        /// @notice Swap policy, in BPS of NAV. 0 means "use the default" (75% position / 75% trade /
        ///         50% deviation). Non-zero values must be 1..10000. Set once at creation; no setter.
        uint256 maxPositionBps;
        uint256 maxTradeBps;
        uint256 maxDeviationBps;
    }

    address public owner;
    address public pendingOwner;
    address public feeRecipient;
    IFundAllowlist public immutable allowlist;
    address public immutable weth;
    address public immutable swapFacet;
    FundVaultDeployer public immutable vaultDeployer;
    FundNFTDeployer public immutable nftDeployer;

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
        uint256 skinRequired,
        bytes32 mandateHash,
        string mandateUri
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
        if (!IFundAllowlist(_allowlist).assetAllowed(_weth) || IFundAllowlist(_allowlist).quoteAsset() != _weth) {
            revert InvalidParams();
        }
        owner = msg.sender;
        vaultDeployer = new FundVaultDeployer();
        nftDeployer = new FundNFTDeployer();
        feeRecipient = _feeRecipient;
        allowlist = IFundAllowlist(_allowlist);
        weth = _weth;
        swapFacet = _swapFacet;
        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientSet(_feeRecipient);
    }

    function previewSupply(uint256 raiseCap, uint256 mintPrice)
        external
        pure
        returns (uint256 maxSupply, uint256 dust)
    {
        if (mintPrice == 0) revert InvalidParams();
        maxSupply = raiseCap / mintPrice;
        dust = raiseCap % mintPrice;
    }

    /// @notice Deploy a vault and an NFT. `mandateHash` is stored as given. `assets` is the per-fund universe.
    ///         Each asset must already be on the global allowlist, and must not be WETH (WETH is the quote).
    function createFund(Params calldata p) external nonReentrant returns (address fund) {
        uint256 nameLen = bytes(p.name).length;
        uint256 symbolLen = bytes(p.symbol).length;
        if (nameLen == 0 || nameLen > 64 || symbolLen == 0 || symbolLen > 16) revert InvalidParams();
        if (bytes(p.imageUri).length > 512 || bytes(p.baseURI).length > 512) revert InvalidParams();
        if (p.mintPrice < MIN_MINT_PRICE || p.mintPrice > MAX_MINT_PRICE) revert InvalidParams();
        if (p.raiseCap < p.mintPrice || p.entryFeeBps > MAX_ENTRY_FEE_BPS) revert InvalidParams();
        if (p.mandateHash == bytes32(0) || p.assets.length > MAX_ASSETS) revert InvalidParams();
        if (bytes(p.mandateUri).length == 0 || bytes(p.mandateUri).length > 512) revert InvalidParams();
        if (p.maxPositionBps > BPS || p.maxTradeBps > BPS || p.maxDeviationBps > BPS) revert InvalidParams();
        if (p.raiseDuration < MIN_RAISE_DURATION || p.raiseDuration > MAX_RAISE_DURATION) revert InvalidParams();

        uint256 maxSupply = p.raiseCap / p.mintPrice;
        if (maxSupply == 0 || maxSupply > MAX_SUPPLY) revert InvalidParams();

        uint256 skinBps = p.minSkinBps == 0 ? DEFAULT_MIN_SKIN_BPS : p.minSkinBps;
        if (skinBps < DEFAULT_MIN_SKIN_BPS || skinBps > BPS) revert InvalidParams();
        uint256 skinRequired = (maxSupply * skinBps + BPS - 1) / BPS;
        if (skinRequired == 0 || skinRequired > maxSupply) revert InvalidParams();
        _checkAssets(p.assets);

        FundVaultInvest vault = vaultDeployer.deploy(
            msg.sender,
            p.raiseCap,
            maxSupply,
            p.entryFeeBps,
            PROTOCOL_FEE_BPS,
            address(allowlist),
            weth,
            p.mandateHash,
            p.assets,
            swapFacet,
            uint64(block.timestamp + p.raiseDuration),
            p.mandateUri,
            p.maxPositionBps,
            p.maxTradeBps,
            p.maxDeviationBps
        );
        FundNFTInvest nft = nftDeployer.deploy(
            FundNFTInvest.Init({
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
            fund,
            address(vault),
            msg.sender,
            p.mintPrice,
            p.raiseCap,
            maxSupply,
            p.entryFeeBps,
            skinBps,
            skinRequired,
            p.mandateHash,
            p.mandateUri
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

    function _checkAssets(address[] calldata assets) internal view {
        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            if (asset == address(0) || asset == weth || asset == address(allowlist)) revert InvalidParams();
            if (!allowlist.assetAllowed(asset)) revert InvalidParams();
            (address feed,,,) = allowlist.feedOf(asset);
            if (feed == address(0)) revert InvalidParams();
            for (uint256 j; j < i; ++j) {
                if (assets[j] == asset) revert InvalidParams();
            }
        }
    }
}
