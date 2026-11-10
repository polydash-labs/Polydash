// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPhase5Lock, IPhase5Registry, IPhase5Royalty, IPhase5Share, Phase5Fund} from "./IPhase5.sol";

/// @title FundSecondaryMarket
/// @notice Fixed-ETH listings for Phase 3 fund shares. Approval listings leave the share with the
///         holder. Escrow listings hold the share until a fill or a cancel by the seller.
///         Proceeds are credited and pulled. Phase 3 charges the manager entry fee and the protocol
///         fee on mint. This market does not mint and does not call `exit`. It reads `royaltyInfo`
///         when that call succeeds and has no argument that sets the amount to zero. A sale whose
///         reported royalty exceeds the price reverts. The Phase 3 share has no royalty interface,
///         so that read pays nothing. A direct `transferFrom` on the share does not pass through here.
///         Not audited. Not a review. Not financial advice.
contract FundSecondaryMarket is ReentrancyGuard {
    uint8 public constant MODE_APPROVAL = 1;
    uint8 public constant MODE_ESCROW = 2;

    struct Listing {
        address seller;
        address nft;
        uint256 tokenId;
        uint256 price;
        uint8 mode;
        bool active;
    }

    address public immutable factory;
    address public immutable registry;

    mapping(uint256 id => Listing) internal _listings;
    mapping(address nft => mapping(uint256 tokenId => uint256 id)) public activeId;
    mapping(address account => uint256 amount) public proceeds;
    uint256 public owedTotal;
    uint256 public listingCount;

    event Listed(
        uint256 indexed id, address indexed nft, uint256 indexed tokenId, address seller, uint256 price, uint8 mode
    );
    event Filled(uint256 indexed id, address indexed buyer, address indexed seller, uint256 price, uint256 royalty);
    event ListingCancelled(uint256 indexed id, address indexed seller);
    event ProceedsWithdrawn(address indexed account, uint256 amount);

    error ZeroAddress();
    error BadPrice();
    error NotHolder();
    error NotSeller();
    error AlreadyListed();
    error NoListing();
    error NotApproved();
    error BadValue();
    error SelfFill();
    error BadBuyer();
    error ShareLocked();
    error SkinLocked();
    error BadRoyalty();
    error NothingToWithdraw();
    error PayFailed();
    error DirectEth();
    error NotModule();
    error UnexpectedNft();

    modifier onlyModule() {
        address sender = msg.sender;
        if (sender != IPhase5Registry(registry).locks() && sender != IPhase5Registry(registry).navFloor()) {
            revert NotModule();
        }
        _;
    }

    constructor(address phase3Factory, address phase5Registry) {
        if (phase3Factory == address(0) || phase5Registry == address(0)) revert ZeroAddress();
        factory = phase3Factory;
        registry = phase5Registry;
    }

    receive() external payable {
        revert DirectEth();
    }

    /// @dev Shares move with `transferFrom`. The receiver hook reverts so a pushed share is not left here.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert UnexpectedNft();
    }

    function listing(uint256 id) external view returns (Listing memory) {
        return _listings[id];
    }

    function holds(address nft, uint256 tokenId) external view returns (bool) {
        uint256 id = activeId[nft][tokenId];
        if (id == 0) return false;
        Listing memory row = _listings[id];
        return row.active && row.mode == MODE_ESCROW;
    }

    /// @notice Approval listing. The share stays with the caller. Fill requires this contract to be approved.
    function list(address nft, uint256 tokenId, uint256 price) external nonReentrant returns (uint256 id) {
        id = _open(nft, tokenId, price, MODE_APPROVAL);
    }

    /// @notice Escrow listing. The caller must have approved this contract. Cancel returns the share.
    function listEscrow(address nft, uint256 tokenId, uint256 price) external nonReentrant returns (uint256 id) {
        id = _open(nft, tokenId, price, MODE_ESCROW);
        IPhase5Share(nft).transferFrom(msg.sender, address(this), tokenId);
        if (IPhase5Share(nft).ownerOf(tokenId) != address(this)) revert NotHolder();
    }

    function fill(uint256 id) external payable nonReentrant {
        Listing memory row = _listings[id];
        if (!row.active) revert NoListing();
        if (msg.value != row.price) revert BadValue();
        if (msg.sender == row.seller) revert SelfFill();
        address vault = Phase5Fund.vaultOf(factory, row.nft);
        if (_blockedBuyer(msg.sender, row.nft, vault)) revert BadBuyer();
        if (IPhase5Lock(IPhase5Registry(registry).locks()).inCustody(row.nft, row.tokenId)) revert ShareLocked();
        if (Phase5Fund.skinLocked(row.nft, row.tokenId)) revert SkinLocked();

        if (row.mode == MODE_APPROVAL) {
            if (IPhase5Share(row.nft).ownerOf(row.tokenId) != row.seller) revert NotHolder();
            bool approved = IPhase5Share(row.nft).getApproved(row.tokenId) == address(this)
                || IPhase5Share(row.nft).isApprovedForAll(row.seller, address(this));
            if (!approved) revert NotApproved();
        } else if (IPhase5Share(row.nft).ownerOf(row.tokenId) != address(this)) {
            revert NotHolder();
        }

        (address receiver, uint256 royalty) = _royalty(row.nft, row.tokenId, row.price);
        _take(id, row);
        proceeds[row.seller] += row.price - royalty;
        if (royalty > 0) proceeds[receiver] += royalty;
        owedTotal += row.price;
        emit Filled(id, msg.sender, row.seller, row.price, royalty);
        address from = row.mode == MODE_ESCROW ? address(this) : row.seller;
        IPhase5Share(row.nft).transferFrom(from, msg.sender, row.tokenId);
    }

    /// @notice Seller cancels. For an approval listing, the current holder may also cancel once they are no longer the seller.
    function cancel(uint256 id) external nonReentrant {
        Listing memory row = _listings[id];
        if (!row.active) revert NoListing();
        if (row.mode == MODE_ESCROW) {
            if (msg.sender != row.seller) revert NotSeller();
            _take(id, row);
            emit ListingCancelled(id, row.seller);
            IPhase5Share(row.nft).transferFrom(address(this), row.seller, row.tokenId);
            return;
        }
        address owner = IPhase5Share(row.nft).ownerOf(row.tokenId);
        if (msg.sender != row.seller && msg.sender != owner) revert NotSeller();
        _take(id, row);
        emit ListingCancelled(id, row.seller);
    }

    /// @notice Drop an approval listing because the share is moving into a lock or an exit queue.
    ///         An escrow listing is left in place; the share is already here.
    function clearApprovalListing(address nft, uint256 tokenId) external nonReentrant onlyModule {
        uint256 id = activeId[nft][tokenId];
        if (id == 0) return;
        Listing memory row = _listings[id];
        if (!row.active || row.mode != MODE_APPROVAL) return;
        _take(id, row);
        emit ListingCancelled(id, row.seller);
    }

    function withdraw() external nonReentrant {
        uint256 amount = proceeds[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        proceeds[msg.sender] = 0;
        owedTotal -= amount;
        emit ProceedsWithdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert PayFailed();
    }

    function _open(address nft, uint256 tokenId, uint256 price, uint8 mode) internal returns (uint256 id) {
        if (price == 0) revert BadPrice();
        address vault = Phase5Fund.vaultOf(factory, nft);
        if (vault == address(0)) revert Phase5Fund.NotFund();
        if (IPhase5Share(nft).ownerOf(tokenId) != msg.sender) revert NotHolder();
        if (IPhase5Lock(IPhase5Registry(registry).locks()).inCustody(nft, tokenId)) revert ShareLocked();
        if (Phase5Fund.skinLocked(nft, tokenId)) revert SkinLocked();
        if (activeId[nft][tokenId] != 0) revert AlreadyListed();
        id = ++listingCount;
        _listings[id] = Listing({
            seller: msg.sender, nft: nft, tokenId: tokenId, price: price, mode: mode, active: true
        });
        activeId[nft][tokenId] = id;
        emit Listed(id, nft, tokenId, msg.sender, price, mode);
    }

    function _take(uint256 id, Listing memory row) internal {
        delete _listings[id];
        if (activeId[row.nft][row.tokenId] == id) delete activeId[row.nft][row.tokenId];
    }

    function _royalty(address nft, uint256 tokenId, uint256 price)
        internal
        view
        returns (address receiver, uint256 amount)
    {
        try IPhase5Royalty(nft).royaltyInfo(tokenId, price) returns (address to, uint256 royalty) {
            if (royalty == 0) return (address(0), 0);
            if (royalty > price || to == address(0) || to == address(this)) revert BadRoyalty();
            return (to, royalty);
        } catch {
            return (address(0), 0);
        }
    }

    function _blockedBuyer(address buyer, address nft, address vault) internal view returns (bool) {
        if (buyer == address(0) || buyer == address(this) || buyer == nft || buyer == vault) return true;
        IPhase5Registry book = IPhase5Registry(registry);
        return buyer == book.locks() || buyer == book.navFloor() || buyer == book.carry() || buyer == book.renderer();
    }
}
