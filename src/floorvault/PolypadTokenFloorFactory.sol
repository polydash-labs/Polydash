// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {PolypadTokenFloorCollection} from "./PolypadTokenFloorCollection.sol";
import {ILaunchFactoryInfo, ILaunchInfo} from "./Interfaces.sol";

/// @title PolypadTokenFloorFactory (DRAFT - not deployed, not audited)
/// @notice Deploys EIP-1167 clones of PolypadTokenFloorCollection. Only the launch creator of a Polypad token
///         may create one for that token. No owner. Existing NFT factories are untouched.
contract PolypadTokenFloorFactory {
    address public immutable implementation;
    address public immutable launchFactoryA;
    address public immutable launchFactoryB;
    address public immutable feeSource;
    address public immutable poolManager;

    uint256 public constant MAX_TOKEN_SHARE_BPS = 5_000;
    uint256 public constant MIN_TOKEN_SHARE_BPS = 1_000;

    struct Params {
        string name;
        string symbol;
        string imageUri;
        string description;
        string baseURI;
        uint256 maxSupply;
        uint256 price;
        uint256 floorBps;
        uint256 tokenShareBps;
        uint256 maxSlippageBps;
        uint256 maxBuyEth;
        uint96 royaltyBps;
        uint256 maxPerWallet;
        uint64 startTime; // 0 = now
        address token;
        address payoutWallet; // 0 = creator
    }

    address[] public allCollections;
    mapping(address => bool) public isCollection;
    mapping(address => address[]) internal _byCreator;
    mapping(address => address[]) internal _byToken;

    event TokenFloorCollectionCreated(
        address indexed collection, address indexed creator, address indexed token, address launch,
        uint256 price, uint256 floorBps, uint256 tokenShareBps
    );

    error NotLaunchToken();
    error NotCreator();
    error InvalidParams();

    constructor(address _launchFactoryA, address _launchFactoryB, address _feeSource, address _poolManager) {
        if (_launchFactoryA == address(0) || _feeSource == address(0) || _poolManager == address(0)) {
            revert InvalidParams();
        }
        launchFactoryA = _launchFactoryA;
        launchFactoryB = _launchFactoryB;
        feeSource = _feeSource;
        poolManager = _poolManager;
        implementation = address(new PolypadTokenFloorCollection());
    }

    function launchOf(address token) public view returns (address l) {
        l = _lookup(launchFactoryA, token);
        if (l == address(0) && launchFactoryB != address(0)) l = _lookup(launchFactoryB, token);
    }

    function _lookup(address f, address token) internal view returns (address l) {
        try ILaunchFactoryInfo(f).launchOfToken(token) returns (address x) {
            if (x != address(0) && ILaunchFactoryInfo(f).isLaunch(x) && ILaunchInfo(x).token() == token) l = x;
        } catch {}
    }

    function createCollection(Params calldata p) external returns (address c) {
        address l = launchOf(p.token);
        if (l == address(0)) revert NotLaunchToken();
        if (ILaunchInfo(l).creator() != msg.sender) revert NotCreator();
        uint256 nl = bytes(p.name).length;
        uint256 sl = bytes(p.symbol).length;
        if (
            nl == 0 || nl > 64 || sl == 0 || sl > 16 || bytes(p.baseURI).length > 256
                || bytes(p.imageUri).length > 256 || bytes(p.description).length > 1000
                || p.maxSupply == 0 || p.maxSupply > 10_000
                || p.price < 0.00001 ether || p.price > 100 ether
                || p.floorBps < 2_000 || p.floorBps > 8_000
                || p.tokenShareBps < MIN_TOKEN_SHARE_BPS || p.tokenShareBps > MAX_TOKEN_SHARE_BPS
                || p.maxSlippageBps < 100 || p.maxSlippageBps > 1_000
                || p.maxBuyEth < 0.001 ether || p.maxBuyEth > 10 ether
                || p.royaltyBps > 1_000
                || p.maxPerWallet == 0 || p.maxPerWallet > 100 || p.maxPerWallet > p.maxSupply
                || (p.startTime != 0 && p.startTime > block.timestamp + 30 days)
        ) revert InvalidParams();

        c = Clones.clone(implementation);
        address payout = p.payoutWallet == address(0) ? msg.sender : p.payoutWallet;
        PolypadTokenFloorCollection(payable(c)).initialize(
            PolypadTokenFloorCollection.Init({
                name: p.name,
                symbol: p.symbol,
                imageUri: p.imageUri,
                description: p.description,
                baseURI: p.baseURI,
                maxSupply: p.maxSupply,
                price: p.price,
                floorBps: p.floorBps,
                tokenShareBps: p.tokenShareBps,
                maxSlippageBps: p.maxSlippageBps,
                maxBuyEth: p.maxBuyEth,
                royaltyBps: p.royaltyBps,
                maxPerWallet: p.maxPerWallet,
                startTime: p.startTime == 0 ? uint64(block.timestamp) : p.startTime,
                creator: msg.sender,
                payoutWallet: payout,
                launch: l,
                token: p.token,
                feeSource: feeSource,
                poolManager: poolManager
            })
        );
        allCollections.push(c);
        isCollection[c] = true;
        _byCreator[msg.sender].push(c);
        _byToken[p.token].push(c);
        emit TokenFloorCollectionCreated(c, msg.sender, p.token, l, p.price, p.floorBps, p.tokenShareBps);
    }

    function collectionsLength() external view returns (uint256) {
        return allCollections.length;
    }

    function collectionsOf(address creator) external view returns (address[] memory) {
        return _byCreator[creator];
    }

    function collectionsOfToken(address token) external view returns (address[] memory) {
        return _byToken[token];
    }
}
