// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPhase5Vault, Phase5Fund} from "./IPhase5.sol";

/// @title FundCarryRights
/// @notice One ERC-721 per Phase 3 fund. The manager points the vault `payoutWallet` here and calls `arm`.
///         ETH the vault then sends to this contract is credited to the current token holder.
///         The Phase 3 vault pays entry fees and performance fees to the same wallet, and only the manager
///         can replace that wallet. Protocol fees still use the factory fee recipient.
///         Transfer is rejected while the raise status is Raising, while the drawdown brake is on,
///         or while a configured brake cannot be read. This token does not promise a payment.
///         Not audited. Not a review. Not financial advice.
contract FundCarryRights is ERC721, ReentrancyGuard {
    struct Right {
        address nft;
        address vault;
    }

    address public immutable factory;
    address public immutable registry;

    uint256 public nextId;
    uint256 public liability;
    mapping(uint256 tokenId => Right) public rights;
    mapping(address nft => uint256 tokenId) public idOf;
    mapping(address vault => address nft) public nftOfVault;
    mapping(address nft => uint256 credited) public credited;
    mapping(address nft => uint256 claimed) public claimed;

    event Armed(address indexed nft, uint256 indexed tokenId, address indexed manager);
    event FeeReceived(address indexed nft, uint256 amount);
    event CarryClaimed(address indexed nft, address indexed holder, uint256 amount);

    error ZeroAddress();
    error NotManager();
    error AlreadyArmed();
    error PayoutNotSet();
    error NotArmed();
    error NotHolder();
    error NothingToClaim();
    error TransferBlocked();
    error DirectEth();
    error PayFailed();

    constructor(address phase3Factory, address phase5Registry) ERC721("Polypad Carry", "CARRY") {
        if (phase3Factory == address(0) || phase5Registry == address(0)) revert ZeroAddress();
        factory = phase3Factory;
        registry = phase5Registry;
    }

    receive() external payable {
        address nft = nftOfVault[msg.sender];
        if (nft == address(0) || msg.value == 0) revert DirectEth();
        credited[nft] += msg.value;
        liability += msg.value;
        emit FeeReceived(nft, msg.value);
    }

    /// @notice Mint the carry token to the manager. `payoutWallet` must already be this contract.
    function arm(address nft) external nonReentrant returns (uint256 tokenId) {
        address vault = Phase5Fund.vaultOf(factory, nft);
        if (IPhase5Vault(vault).manager() != msg.sender) revert NotManager();
        if (idOf[nft] != 0) revert AlreadyArmed();
        if (IPhase5Vault(vault).payoutWallet() != address(this)) revert PayoutNotSet();
        tokenId = ++nextId;
        idOf[nft] = tokenId;
        nftOfVault[vault] = nft;
        rights[tokenId] = Right({nft: nft, vault: vault});
        emit Armed(nft, tokenId, msg.sender);
        _mint(msg.sender, tokenId);
    }

    function claim(address nft) external nonReentrant returns (uint256 amount) {
        uint256 tokenId = idOf[nft];
        if (tokenId == 0) revert NotArmed();
        if (ownerOf(tokenId) != msg.sender) revert NotHolder();
        amount = credited[nft] - claimed[nft];
        if (amount == 0) revert NothingToClaim();
        claimed[nft] = credited[nft];
        liability -= amount;
        emit CarryClaimed(nft, msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert PayFailed();
    }

    function claimable(address nft) external view returns (uint256) {
        return credited[nft] - claimed[nft];
    }

    /// @notice True when the vault wallet is still this contract.
    function routed(address nft) external view returns (bool) {
        uint256 tokenId = idOf[nft];
        if (tokenId == 0) return false;
        return IPhase5Vault(rights[tokenId].vault).payoutWallet() == address(this);
    }

    function transferFrom(address from, address to, uint256 tokenId) public override nonReentrant {
        super.transferFrom(from, to, tokenId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            if (to == address(0)) revert TransferBlocked();
            address vault = rights[tokenId].vault;
            if (Phase5Fund.raiseOpen(vault) || Phase5Fund.brakeActive(vault)) revert TransferBlocked();
        }
        return super._update(to, tokenId, auth);
    }
}
