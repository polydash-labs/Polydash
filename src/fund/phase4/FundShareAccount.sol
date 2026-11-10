// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title FundShareAccount
/// @notice ERC-6551 account implementation for one Phase 3 fund share. The canonical registry
///         deploys a proxy that delegatecalls this code and appends the token binding.
///         The current NFT owner is the only caller. CALL is the only operation.
///         Burning the share (exit or refund) freezes the account, because `ownerOf` no longer
///         returns a holder. Move assets out before that. Sending the share into this account
///         freezes both. Not audited. Not a review. Not financial advice.
contract FundShareAccount {
    uint256 internal constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    bytes4 internal constant SIGNER_MAGIC = 0x523e3260;

    address public immutable factory;
    /// @dev The implementation address. A direct call is not a proxy and has no token binding.
    address public immutable root;
    uint256 public state;
    uint256 private _lock;

    error DirectAccount();
    error BadFactory();
    error WrongChain();
    error NotFund();
    error NotOwner();
    error WalletLoop();
    error BadOperation();
    error Locked();
    error CallFailed();

    event AccountExecuted(address indexed to, uint256 value, bytes data);

    constructor(address phase3Factory) {
        if (phase3Factory == address(0)) revert BadFactory();
        factory = phase3Factory;
        root = address(this);
    }

    receive() external payable {}

    /// @notice Chain, token contract, and token id appended by the ERC-6551 registry proxy.
    function token() public view returns (uint256 chainId, address tokenContract, uint256 tokenId) {
        if (address(this) == root) return (0, address(0), 0);
        bytes memory footer = new bytes(0x60);
        assembly {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    /// @notice Current owner of the bound share. Zero when the call is not a proxy, the chain id
    ///         does not match, or the share has been burned.
    function owner() public view returns (address) {
        if (address(this) == root) return address(0);
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid || tokenContract == address(0)) return address(0);
        try IERC721View(tokenContract).ownerOf(tokenId) returns (address holder) {
            return holder;
        } catch {
            return address(0);
        }
    }

    function isValidSigner(address signer, bytes calldata) external view returns (bytes4) {
        address holder = owner();
        if (signer != address(0) && signer == holder && holder != address(this)) return SIGNER_MAGIC;
        return bytes4(0);
    }

    /// @notice ERC-1271. The signature is a 65-byte compact signature over `hash`.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (signature.length != 65) return bytes4(0xffffffff);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > HALF_N) return bytes4(0xffffffff);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return bytes4(0xffffffff);
        address recovered = ecrecover(hash, v, r, s);
        address holder = owner();
        if (recovered == address(0) || recovered != holder || holder == address(this)) return bytes4(0xffffffff);
        return ERC1271_MAGIC;
    }

    /// @notice Run a call as the share wallet. `operation` must be 0 (CALL). Delegatecall is rejected.
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory result)
    {
        if (address(this) == root) revert DirectAccount();
        if (to == address(0)) revert CallFailed();
        if (_lock != 0) revert Locked();
        if (operation != 0) revert BadOperation();
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid) revert WrongChain();
        if (!IPhase3FactoryView(factory).isFund(tokenContract)) revert NotFund();
        address holder = IERC721View(tokenContract).ownerOf(tokenId);
        if (holder == address(0) || msg.sender != holder) revert NotOwner();
        if (holder == address(this)) revert WalletLoop();
        _lock = 1;
        state += 1;
        emit AccountExecuted(to, value, data);
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        _lock = 0;
        if (!ok) _bubble(ret);
        return ret;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x6faff5f1 || id == 0x51945447 || id == 0x150b7a02;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return 0xbc197c81;
    }

    function _bubble(bytes memory ret) internal pure {
        if (ret.length == 0) revert CallFailed();
        assembly {
            revert(add(ret, 32), mload(ret))
        }
    }
}

interface IPhase3FactoryView {
    function isFund(address fund) external view returns (bool);
}

interface IERC721View {
    function ownerOf(uint256 tokenId) external view returns (address);
}
