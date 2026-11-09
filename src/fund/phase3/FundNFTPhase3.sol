// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {FundVaultPhase3} from "./FundVaultPhase3.sol";
import {FundVaultStore} from "../phase2/FundVaultStore.sol";

/// @title FundNFTPhase3
/// @notice Units for one Phase 3 fund. The manager's skin token ids cannot transfer until `skinUnlockTime`.
///         Burns for exit and refund are allowed during the lock. This contract is not deployed.
///         Not a review. Not financial advice.
contract FundNFTPhase3 is ERC721, ReentrancyGuard {
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
        uint64 skinUnlockTime;
    }

    address public immutable factory;
    address public immutable manager;
    FundVaultPhase3 public immutable vault;
    uint64 public immutable skinUnlockTime;
    uint256 public immutable mintPrice;
    uint256 public immutable maxSupply;
    uint256 public immutable entryFeeBps;
    uint256 public immutable protocolFeeBps;
    uint256 public immutable minSkinBps;
    uint256 public immutable skinRequired;

    string public imageUri;
    string private _base;

    uint256 public totalMinted;
    uint256 public totalBurned;
    uint256 public managerMinted;
    bool public publicOpen;

    event Minted(address indexed minter, uint256 qty, uint256 firstTokenId, uint256 paid);
    event PublicMintOpened(uint256 managerMinted);
    event BaseURIUpdated(string baseURI);

    error NotRaising();
    error RaiseEnded();
    error NotHolder();
    error SkinRequired();
    error BadQuantity();
    error BadValue();
    error SoldOut();
    error NotManager();
    error Frozen();
    error InvalidParams();
    error SkinLocked();

    constructor(Init memory init) ERC721(init.name, init.symbol) {
        factory = init.factory;
        manager = init.manager;
        vault = FundVaultPhase3(payable(init.vault));
        skinUnlockTime = init.skinUnlockTime;
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
        if (block.timestamp > vault.raiseDeadline()) revert RaiseEnded();
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
        return totalMinted - totalBurned;
    }

    function outstanding() public view returns (uint256) {
        return totalMinted - totalBurned;
    }

    /// @notice Burn units of a failed raise. The current owner is paid their share of spendable ETH.
    ///         Entry and protocol fees are not included. A transferred unit pays the current holder.
    function refund(uint256[] calldata ids) external nonReentrant {
        if (vault.status() != FundVaultStore.Status.Failed) revert NotRaising();
        vault.claimAll(msg.sender, ids);
        (uint256 n, uint256 supplyBefore) = _take(ids);
        vault.settleRefund(msg.sender, n, supplyBefore);
    }

    /// @notice Burn units after a successful close and take a pro-rata share of vault inventory.
    ///         The last outstanding units receive rounding dust. A short token transfer reverts the burn.
    function exit(uint256[] calldata ids) external nonReentrant {
        FundVaultStore.Status state = vault.status();
        if (state != FundVaultStore.Status.RaisingClosed && state != FundVaultStore.Status.Investing) {
            revert NotRaising();
        }
        vault.claimAll(msg.sender, ids);
        (uint256 n, uint256 supplyBefore) = _take(ids);
        vault.settleExit(msg.sender, n, supplyBefore);
    }

    /// @notice Skin token ids stay with the manager until `skinUnlockTime`. A burn is not a transfer.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address current = _ownerOf(tokenId);
        if (current != address(0) && to != address(0) && tokenId <= skinRequired && block.timestamp < skinUnlockTime) {
            revert SkinLocked();
        }
        return super._update(to, tokenId, auth);
    }

    function remainingSupply() external view returns (uint256) {
        return maxSupply - totalMinted;
    }

    function ownershipBps(address account) public view returns (uint256) {
        uint256 live = outstanding();
        if (live == 0) return 0;
        return (balanceOf(account) * BPS) / live;
    }

    /// @notice Vault market NAV divided by outstanding NFTs. Reverts when a required feed cannot be used.
    function navPerNft() public view returns (uint256) {
        return vault.navPerNft();
    }

    function _take(uint256[] calldata ids) internal returns (uint256 n, uint256 supplyBefore) {
        n = ids.length;
        if (n == 0 || n > 100) revert BadQuantity();
        supplyBefore = outstanding();
        if (n > supplyBefore) revert BadQuantity();
        for (uint256 i; i < n; ++i) {
            if (ownerOf(ids[i]) != msg.sender) revert NotHolder();
            for (uint256 j; j < i; ++j) {
                if (ids[j] == ids[i]) revert BadQuantity();
            }
            _burn(ids[i]);
        }
        totalBurned += n;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (bytes(_base).length == 0) return imageUri;
        return string.concat(_base, tokenId.toString(), ".json");
    }
}
