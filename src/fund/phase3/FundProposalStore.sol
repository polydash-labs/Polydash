// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title FundProposalStore (not reviewed, not deployed)
/// @notice Proposal storage appended after `FundPhase3Store` for a Phase 3 V2 vault and its swap
///         facet. Both contracts inherit it in the same position so a delegatecall sees one layout:
///         `FundVaultStore`, then `FundPhase3Store`, then this store. The V2 vault declares
///         `mandateUri` after all three stores; the facet never reads it, so the shared prefix
///         stays aligned. New storage goes at the end of this contract only, never in the middle.
///         This contract is not deployed. Not a review. Not financial advice.
abstract contract FundProposalStore {
    /// @notice Public wait before a proposed asset (or removal) can be executed. Mirrors the
    ///         allowlist delay: the two waits run in parallel and both must be live before a buy.
    uint256 public constant PROPOSAL_DELAY = 172800;
    /// @notice Thesis URI bound, mirroring the mandate URI bound.
    uint256 public constant MAX_THESIS_URI_BYTES = 512;
    /// @notice Short reason bound: the up-to-three-lines text shown on the proposal card.
    uint256 public constant MAX_REASON_BYTES = 512;
    /// @notice Default per-asset cap when a proposal passes 0: 30% (Jon's decision).
    uint256 public constant DEFAULT_ASSET_CAP_BPS = 3000;

    enum ProposalStatus {
        Pending,
        Executed,
        Cancelled
    }

    enum ProposalKind {
        Add,
        Remove
    }

    struct Proposal {
        address asset;
        uint256 maxPositionBps;
        string reason;
        string thesisUri;
        uint64 readyAt;
        ProposalStatus status;
        ProposalKind kind;
    }

    /// @notice Sequential proposal ids, starting at 1.
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    /// @notice Per-asset position cap in bps, set when a proposal executes. 0 means "no proposal
    ///         cap": the template's `maxPositionBps` alone applies (template assets have no
    ///         proposal, so their cap is always 0).
    mapping(address => uint256) public assetCap;
    /// @notice True once an asset has ever entered the mandate. Set on execution of an add
    ///         proposal and NEVER cleared by removal: an asset that was ever in the mandate can
    ///         always be sold. Buys use `inMandate`; sells use this.
    mapping(address => bool) public sellable;

    event AssetProposed(
        uint256 indexed id,
        address indexed asset,
        uint256 maxPositionBps,
        string reason,
        string thesisUri,
        uint64 readyAt
    );
    event AssetExecuted(uint256 indexed id, address indexed asset, uint256 maxPositionBps);
    event RemovalProposed(uint256 indexed id, address indexed asset, uint64 readyAt);
    event AssetRemoved(uint256 indexed id, address indexed asset);
    event ProposalCancelled(uint256 indexed id, address indexed asset);

    error BadProposal();
    error NotPending();
    error AlreadyInMandate();
    error NotSellable();
}
