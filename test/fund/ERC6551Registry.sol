// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Test copy of the canonical ERC-6551 registry (MIT, erc6551/reference).
///         Unit tests etch this runtime code at the canonical address. The Phase 4
///         deploy script does not deploy a registry.
interface IERC6551RegistryTest {
    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    error AccountCreationFailed();

    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account);

    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address account);
}

contract ERC6551Registry is IERC6551RegistryTest {
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address) {
        assembly {
            pop(chainId)
            calldatacopy(0x8c, 0x24, 0x80)
            mstore(0x6c, 0x5af43d82803e903d91602b57fd5bf3)
            mstore(0x5d, implementation)
            mstore(0x49, 0x3d60ad80600a3d3981f3363d3d373d3d3d363d73)
            mstore8(0x00, 0xff)
            mstore(0x35, keccak256(0x55, 0xb7))
            mstore(0x01, shl(96, address()))
            mstore(0x15, salt)
            let computed := keccak256(0x00, 0x55)
            if iszero(extcodesize(computed)) {
                let deployed := create2(0, 0x55, 0xb7, salt)
                if iszero(deployed) {
                    mstore(0x00, 0x20188a59)
                    revert(0x1c, 0x04)
                }
                mstore(0x6c, deployed)
                log4(
                    0x6c,
                    0x60,
                    0x79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf88722,
                    implementation,
                    tokenContract,
                    tokenId
                )
                return(0x6c, 0x20)
            }
            mstore(0x00, shr(96, shl(96, computed)))
            return(0x00, 0x20)
        }
    }

    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address)
    {
        assembly {
            pop(chainId)
            pop(tokenContract)
            pop(tokenId)
            calldatacopy(0x8c, 0x24, 0x80)
            mstore(0x6c, 0x5af43d82803e903d91602b57fd5bf3)
            mstore(0x5d, implementation)
            mstore(0x49, 0x3d60ad80600a3d3981f3363d3d373d3d3d363d73)
            mstore8(0x00, 0xff)
            mstore(0x35, keccak256(0x55, 0xb7))
            mstore(0x01, shl(96, address()))
            mstore(0x15, salt)
            mstore(0x00, shr(96, shl(96, keccak256(0x00, 0x55))))
            return(0x00, 0x20)
        }
    }
}
