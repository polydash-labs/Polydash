// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {FundVaultInvest} from "./FundVaultInvest.sol";
import {FundVaultStore} from "./FundVaultStore.sol";

/// @title FundNFTInvest (not reviewed, not deployed)
/// @notice ERC-721 units for one Phase 2 fund. Mint rules match Phase 1a: fixed ETH price, manager skin first.
///         `navPerNft` reads the vault, which counts ETH, WETH, and the quote spent on other holdings.
///         It is not a market price. Phase 1a `FundNFT` is a different contract and is not modified.
contract FundNFTInvest is ERC721, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant BPS = 10_000;

    struct Init {
        string name;
        string symbol;
        string imageUri;
        string baseURI;
        address manager;
        address vault;
        address factory;
        uint256 mintPrice;
        uint256 maxSupply;
        uint256 entryFeeBps;
        uint256 protocolFeeBps;
        uint256 minSkinBps;
        uint256 skinRequired;
    }

    address public immutable factory;
    address public immutable manager;
    FundVaultInvest public immutable vault;
    uint256 public immutable mintPrice;
    uint256 public immutable maxSupply;
    uint256 public immutable entryFeeBps;
    uint256 public immutable protocolFeeBps;
    uint256 public immutable minSkinBps;
    uint256 public immutable skinRequired;

    string public imageUri;
    string private _base;

    uint256 public totalMinted;
    uint256 public managerMinted;
    bool public publicOpen;

    event Minted(address indexed minter, uint256 qty, uint256 firstTokenId, uint256 paid);
    event PublicMintOpened(uint256 managerMinted);
    event BaseURIUpdated(string baseURI);

    error NotRaising();
    error SkinRequired();
    error BadQuantity();
    error BadValue();
    error SoldOut();
    error NotManager();
    error Frozen();
    error InvalidParams();

    constructor(Init memory init) ERC721(init.name, init.symbol) {
        factory = init.factory;
        manager = init.manager;
        vault = FundVaultInvest(payable(init.vault));
        mintPrice = init.mintPrice;
        maxSupply = init.maxSupply;
        entryFeeBps = init.entryFeeBps;
        protocolFeeBps = init.protocolFeeBps;
        minSkinBps = init.minSkinBps;
        skinRequired = init.skinRequired;
        imageUri = init.imageUri;
        _base = init.baseURI;
    }

    /// @notice Mint `qty` NFTs at `mintPrice` each. ETH is forwarded to the vault.
    ///         Until the manager has minted `skinRequired` units, only the manager can call this.
    function mint(uint256 qty) external payable nonReentrant {
        if (qty == 0) revert BadQuantity();
        if (vault.status() != FundVaultStore.Status.Raising) revert NotRaising();
        if (!publicOpen && msg.sender != manager) revert SkinRequired();
        if (totalMinted + qty > maxSupply) revert SoldOut();
        uint256 cost = mintPrice * qty;
        if (msg.value != cost) revert BadValue();

        uint256 first = totalMinted + 1;
        totalMinted += qty;
        if (msg.sender == manager) managerMinted += qty;
        if (!publicOpen && managerMinted >= skinRequired) {
            publicOpen = true;
            emit PublicMintOpened(managerMinted);
        }

        uint256 entryFee = (msg.value * entryFeeBps) / BPS;
        uint256 protocolFee = (msg.value * protocolFeeBps) / BPS;
        vault.deposit{value: msg.value}(entryFee, protocolFee);
        vault.closeIfReady(totalMinted);
        for (uint256 i; i < qty; ++i) {
            _safeMint(msg.sender, first + i);
        }
        emit Minted(msg.sender, qty, first, msg.value);
    }

    function setBaseURI(string calldata next) external {
        if (msg.sender != manager) revert NotManager();
        if (totalMinted != 0) revert Frozen();
        if (bytes(next).length > 512) revert InvalidParams();
        _base = next;
        emit BaseURIUpdated(next);
    }

    function baseURI() external view returns (string memory) {
        return _base;
    }

    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    function remainingSupply() external view returns (uint256) {
        return maxSupply - totalMinted;
    }

    function ownershipBps(address account) public view returns (uint256) {
        if (totalMinted == 0) return 0;
        return (balanceOf(account) * BPS) / totalMinted;
    }

    /// @notice Vault NAV divided by NFTs minted. Zero before the first mint. Not a market price.
    function navPerNft() public view returns (uint256) {
        return vault.navPerNft();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (bytes(_base).length == 0) return imageUri;
        return string.concat(_base, tokenId.toString(), ".json");
    }
}
