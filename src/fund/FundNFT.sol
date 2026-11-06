// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {FundVault} from "./FundVault.sol";

/// @title FundNFT (DRAFT - not reviewed, not deployed)
/// @notice ERC-721 ownership units for one Phase 1a fund. Each NFT is one equal unit.
///         A wallet's share of the raise is balanceOf(wallet) / totalMinted.
///         Buyers pay `mintPrice` in ETH while the vault is Raising. Payment is forwarded
///         to the vault in the same call. The manager must mint at least `skinRequired`
///         units before any other wallet can mint. Tokens are transferable.
///         `navPerNft` is the vault's ETH balance divided by the number of NFTs minted.
///         It is an ETH-only accounting figure for this phase, not a market price.
contract FundNFT is ERC721, ReentrancyGuard {
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
    FundVault public immutable vault;
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
        vault = FundVault(payable(init.vault));
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
        if (vault.status() != FundVault.Status.Raising) revert NotRaising();
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

    /// @notice Metadata base can be set until the first mint, then it is fixed.
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

    /// @notice Floor share of minted supply, in bps (10_000 = 100%). Zero before the first mint.
    ///         Sum across wallets can be short of 10_000 because of integer division.
    function ownershipBps(address account) public view returns (uint256) {
        if (totalMinted == 0) return 0;
        return (balanceOf(account) * BPS) / totalMinted;
    }

    /// @notice Vault ETH balance divided by NFTs minted. Zero before the first mint.
    ///         Integer division; leftover wei stay in the vault. Phase 1a counts ETH only.
    ///         This is not a market price.
    function navPerNft() public view returns (uint256) {
        if (totalMinted == 0) return 0;
        return address(vault).balance / totalMinted;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (bytes(_base).length == 0) return imageUri;
        return string.concat(_base, tokenId.toString(), ".json");
    }
}
