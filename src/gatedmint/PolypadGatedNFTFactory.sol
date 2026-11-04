// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PolypadGatedCollection} from "./PolypadGatedCollection.sol";
import {IPolydashFactoryInfo, IPolydashLaunchInfo} from "../bond/IPolydashLaunchInfo.sol";

/// @dev Token gate is OPTIONAL per collection: holderDuration == 0 => ungated open mint linked to the token.
/// @title PolypadGatedNFTFactory (DRAFT - not deployed, not audited)
/// @notice Ownerless. Deploys token-gated collections. The gate token must be a Polypad launch token
///         (launch factory A or B) and only that launch's on-chain creator() can create a gated collection. Platform fee wallet is read from the live PolypadNFTFactory (feeSource).
contract PolypadGatedNFTFactory {
    uint256 public constant MAX_SUPPLY_LIMIT = 10_000;
    uint256 public constant MIN_MINT_PRICE = 0.00001 ether;
    uint256 public constant MAX_MINT_PRICE = 100 ether;
    uint256 public constant MIN_FLOOR_BPS = 2_000;
    uint256 public constant MAX_FLOOR_BPS = 8_000;
    uint256 public constant MAX_ROYALTY_BPS = 1_000;
    uint256 public constant MIN_HOLDER_PHASE = 1 hours;
    uint256 public constant MAX_HOLDER_PHASE = 30 days;
    uint256 public constant MAX_START_DELAY = 30 days;
    uint256 public constant MAX_PER_WALLET_HARD = 100;

    struct Params {
        string name;
        string symbol;
        string imageUri;
        string description;
        string baseURI;
        uint256 maxSupply;
        uint256 holderPrice;
        uint256 publicPrice; // 0 => holder-only
        uint256 floorBps;
        uint96 royaltyBps;
        uint256 holderMaxPerWallet;
        uint256 maxPerWallet;
        address gateToken;
        uint256 minBalance;
        uint64 holderStart; // 0 => now (for ungated: public mint start)
        uint64 holderDuration; // 0 => UNGATED open mint (holderPrice, minBalance, holderMaxPerWallet must be 0)
        address payoutWallet; // 0 => msg.sender
    }

    address public immutable launchFactoryA;
    address public immutable launchFactoryB;
    address public immutable feeSource;

    address[] public allCollections;
    mapping(address => bool) public isCollection;
    mapping(address => address[]) internal _byCreator;
    mapping(address => address[]) internal _byToken;

    event GatedCollectionCreated(
        address indexed collection,
        address indexed creator,
        address indexed gateToken,
        uint256 minBalance,
        uint256 holderPrice,
        uint256 publicPrice,
        uint64 holderStart,
        uint64 publicStart,
        bool gated
    );

    error ZeroAddress();
    error NotPolydashToken();
    error NotTokenCreator();
    error InvalidParam(string field);

    constructor(address _launchFactoryA, address _launchFactoryB, address _feeSource) {
        if (_launchFactoryA == address(0) || _feeSource == address(0)) revert ZeroAddress();
        launchFactoryA = _launchFactoryA;
        launchFactoryB = _launchFactoryB;
        feeSource = _feeSource;
    }

    function launchOf(address token) public view returns (address launch) {
        launch = IPolydashFactoryInfo(launchFactoryA).launchOfToken(token);
        if (launch == address(0) && launchFactoryB != address(0)) {
            launch = IPolydashFactoryInfo(launchFactoryB).launchOfToken(token);
        }
    }

    function createCollection(Params calldata p) external returns (address collection) {
        address launch = launchOf(p.gateToken);
        if (launch == address(0) || IPolydashLaunchInfo(launch).token() != p.gateToken) revert NotPolydashToken();
        if (IPolydashLaunchInfo(launch).creator() != msg.sender) revert NotTokenCreator();
        uint256 nl = bytes(p.name).length;
        uint256 sl = bytes(p.symbol).length;
        if (nl == 0 || nl > 64) revert InvalidParam("name");
        if (sl == 0 || sl > 16) revert InvalidParam("symbol");
        if (bytes(p.imageUri).length > 512) revert InvalidParam("imageUri");
        if (bytes(p.baseURI).length > 512) revert InvalidParam("baseURI");
        if (bytes(p.description).length > 1000) revert InvalidParam("description");
        if (p.maxSupply == 0 || p.maxSupply > MAX_SUPPLY_LIMIT) revert InvalidParam("maxSupply");
        bool gated = p.holderDuration != 0;
        if (gated) {
            if (p.holderPrice < MIN_MINT_PRICE || p.holderPrice > MAX_MINT_PRICE) revert InvalidParam("holderPrice");
            if (p.publicPrice != 0 && (p.publicPrice < p.holderPrice || p.publicPrice > MAX_MINT_PRICE)) {
                revert InvalidParam("publicPrice");
            }
            if (p.minBalance == 0) revert InvalidParam("minBalance");
            if (p.holderDuration < MIN_HOLDER_PHASE || p.holderDuration > MAX_HOLDER_PHASE) revert InvalidParam("holderDuration");
        } else {
            // Ungated open mint: no holder phase; holder fields must be zero.
            if (p.publicPrice < MIN_MINT_PRICE || p.publicPrice > MAX_MINT_PRICE) revert InvalidParam("publicPrice");
            if (p.holderPrice != 0 || p.minBalance != 0 || p.holderMaxPerWallet != 0) revert InvalidParam("ungated");
        }
        if (p.floorBps < MIN_FLOOR_BPS || p.floorBps > MAX_FLOOR_BPS) revert InvalidParam("floorBps");
        if (p.royaltyBps > MAX_ROYALTY_BPS) revert InvalidParam("royaltyBps");
        if (p.maxPerWallet == 0 || p.maxPerWallet > MAX_PER_WALLET_HARD || p.maxPerWallet > p.maxSupply) {
            revert InvalidParam("maxPerWallet");
        }
        if (gated && (p.holderMaxPerWallet == 0 || p.holderMaxPerWallet > p.maxPerWallet)) revert InvalidParam("holderMaxPerWallet");
        uint64 start = p.holderStart == 0 ? uint64(block.timestamp) : p.holderStart;
        if (start < block.timestamp || start > block.timestamp + MAX_START_DELAY) revert InvalidParam("holderStart");
        uint64 pubStart = start + p.holderDuration;

        address payout = p.payoutWallet == address(0) ? msg.sender : p.payoutWallet;
        collection = address(
            new PolypadGatedCollection(
                PolypadGatedCollection.Init({
                    name: p.name,
                    symbol: p.symbol,
                    imageUri: p.imageUri,
                    description: p.description,
                    baseURI: p.baseURI,
                    maxSupply: p.maxSupply,
                    holderPrice: p.holderPrice,
                    publicPrice: p.publicPrice,
                    floorBps: p.floorBps,
                    royaltyBps: p.royaltyBps,
                    holderMaxPerWallet: p.holderMaxPerWallet,
                    maxPerWallet: p.maxPerWallet,
                    gateToken: p.gateToken,
                    minBalance: p.minBalance,
                    holderStart: start,
                    publicStart: pubStart,
                    creator: msg.sender,
                    payoutWallet: payout,
                    feeSource: feeSource
                })
            )
        );
        allCollections.push(collection);
        isCollection[collection] = true;
        _byCreator[msg.sender].push(collection);
        _byToken[p.gateToken].push(collection);
        emit GatedCollectionCreated(
            collection, msg.sender, p.gateToken, p.minBalance, p.holderPrice, p.publicPrice, start, pubStart, gated
        );
    }

    function allCollectionsLength() external view returns (uint256) { return allCollections.length; }
    function collectionsOf(address c) external view returns (address[] memory) { return _byCreator[c]; }
    function collectionsOfToken(address t) external view returns (address[] memory) { return _byToken[t]; }
}
