// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IPhase5Factory {
    function isFund(address fund) external view returns (bool);
    function weth() external view returns (address);
    function feeRecipient() external view returns (address);
}

interface IPhase5Registry {
    function factory() external view returns (address);
    function market() external view returns (address);
    function renderer() external view returns (address);
    function locks() external view returns (address);
    function carry() external view returns (address);
    function navFloor() external view returns (address);
}

interface IPhase5Vault {
    function manager() external view returns (address);
    function nft() external view returns (address);
    function nav() external view returns (uint256);
    function navPerNft() external view returns (uint256);
    function peakNavPerNft() external view returns (uint256);
    function maxDrawdownBps() external view returns (uint256);
    function hwmPerNft() external view returns (uint256);
    function hwmFeeBps() external view returns (uint256);
    function status() external view returns (uint8);
    function payoutWallet() external view returns (address);
    function weth() external view returns (address);
    function spendableEth() external view returns (uint256);
    function claimableEntryFee() external view returns (uint256);
    function claimableProtocolFee() external view returns (uint256);
    function claimablePerformanceFee() external view returns (uint256);
    function distributionReserved() external view returns (uint256);
    function mandateAssetCount() external view returns (uint256);
    function mandateAssets(uint256 index) external view returns (address);
    function tokenOwed(address holder, address asset) external view returns (uint256);
    function tokenReserved(address asset) external view returns (uint256);
    function claimOwed(address asset) external;
}

interface IPhase5Share {
    function vault() external view returns (address);
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function mintPrice() external view returns (uint256);
    function name() external view returns (string memory);
    function skinRequired() external view returns (uint256);
    function skinUnlockTime() external view returns (uint64);
    function outstanding() external view returns (uint256);
    function exit(uint256[] calldata ids) external;
    function refund(uint256[] calldata ids) external;
}

interface IPhase5Market {
    function clearApprovalListing(address nft, uint256 tokenId) external;
    function holds(address nft, uint256 tokenId) external view returns (bool);
}

interface IPhase5Lock {
    function isLocked(address nft, uint256 tokenId) external view returns (bool);
    function inCustody(address nft, uint256 tokenId) external view returns (bool);
    function tierOf(address nft, uint256 tokenId) external view returns (uint256);
}

interface IPhase5Royalty {
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount);
}

/// @notice Shared reads of a Phase 3 fund. Internal functions are copied into each caller.
///         Not audited. Not a review. Not financial advice.
library Phase5Fund {
    uint256 internal constant BPS = 10_000;
    uint8 internal constant STATUS_RAISING = 0;
    uint8 internal constant STATUS_CLOSED = 1;
    uint8 internal constant STATUS_INVESTING = 2;
    uint8 internal constant STATUS_FAILED = 3;

    error NotFund();

    function vaultOf(address factory, address nft) internal view returns (address vault) {
        if (nft == address(0) || !IPhase5Factory(factory).isFund(nft)) revert NotFund();
        vault = IPhase5Share(nft).vault();
        if (vault == address(0) || IPhase5Vault(vault).nft() != nft) revert NotFund();
    }

    /// @dev True while status is Raising. A read that reverts is treated as still in the raise.
    function raiseOpen(address vault) internal view returns (bool) {
        try IPhase5Vault(vault).status() returns (uint8 status) {
            return status == STATUS_RAISING;
        } catch {
            return true;
        }
    }

    /// @dev True when the template brake is on, or when the brake is configured and the NAV read reverts.
    ///      A max drawdown of 0 cannot be on.
    function brakeActive(address vault) internal view returns (bool) {
        try IPhase5Vault(vault).maxDrawdownBps() returns (uint256 maxDrawdown) {
            if (maxDrawdown == 0) return false;
            try IPhase5Vault(vault).peakNavPerNft() returns (uint256 peak) {
                if (peak == 0) return false;
                try IPhase5Vault(vault).navPerNft() returns (uint256 perShare) {
                    if (perShare >= peak) return false;
                    return ((peak - perShare) * BPS) / peak >= maxDrawdown;
                } catch {
                    return true;
                }
            } catch {
                return true;
            }
        } catch {
            return true;
        }
    }

    function skinLocked(address nft, uint256 tokenId) internal view returns (bool) {
        return tokenId <= IPhase5Share(nft).skinRequired() && block.timestamp < IPhase5Share(nft).skinUnlockTime();
    }
}
