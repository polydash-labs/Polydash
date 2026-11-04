// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

contract MockToken is ERC20 {
    bool public paused;
    bool public returnFalse;
    uint256 public feeBps; // fee-on-transfer, burned
    mapping(address => bool) public blocked;
    address public reenterTarget;
    bytes public reenterData;
    bool public reenterSucceeded;
    uint256 public reenterAttempts;

    constructor() ERC20("Moon", "MOON") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function setPaused(bool p) external {
        paused = p;
    }

    function setReturnFalse(bool r) external {
        returnFalse = r;
    }

    function setFeeBps(uint256 b) external {
        feeBps = b;
    }

    function setBlocked(address a, bool b) external {
        blocked[a] = b;
    }

    function setReenter(address t, bytes calldata d) external {
        reenterTarget = t;
        reenterData = d;
    }

    function transfer(address to, uint256 v) public override returns (bool) {
        if (returnFalse) return false;
        return super.transfer(to, v);
    }

    function _update(address f, address t, uint256 v) internal override {
        require(!paused, "paused");
        require(!blocked[f] && !blocked[t], "blocked");
        if (feeBps > 0 && f != address(0) && t != address(0)) {
            uint256 fee = v * feeBps / 10_000;
            super._update(f, address(0), fee);
            v -= fee;
        }
        super._update(f, t, v);
        address r = reenterTarget;
        if (r != address(0) && (t == r || f == r)) {
            reenterAttempts++;
            reenterTarget = address(0);
            (bool ok,) = r.call(reenterData);
            if (ok) reenterSucceeded = true;
            reenterTarget = r;
        }
    }
}

/// Receives NFTs / ETH and tries to re-enter the collection.
contract ReentrantActor {
    address public target;
    bytes public data;
    bool public succeeded;
    uint256 public attempts;
    bool public armed;

    function setup(address t, bytes calldata d) external {
        target = t;
        data = d;
    }

    function arm(bool a) external {
        armed = a;
    }

    function exec(address to, uint256 v, bytes calldata d) external returns (bytes memory) {
        (bool ok, bytes memory r) = to.call{value: v}(d);
        if (!ok) {
            assembly { revert(add(r, 32), mload(r)) }
        }
        return r;
    }

    function _try() internal {
        if (!armed) return;
        armed = false;
        attempts++;
        (bool ok,) = target.call(data);
        if (ok) succeeded = true;
    }

    receive() external payable {
        _try();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        _try();
        return this.onERC721Received.selector;
    }
}

contract RevertingLaunchFactory {
    function launchOfToken(address) external pure returns (address) {
        revert("x");
    }

    function isLaunch(address) external pure returns (bool) {
        revert("x");
    }
}

contract MockHook {
    PoolKey internal k;

    function setKey(PoolKey memory key) external {
        k = key;
    }

    function poolKeyOf(address) external view returns (PoolKey memory) {
        return k;
    }
}

contract MockLaunch {
    address public creator;
    address public token;
    address public hook;
    bool public graduated;

    constructor(address c, address t, address h) {
        creator = c;
        token = t;
        hook = h;
    }

    function setGraduated(bool g) external {
        graduated = g;
    }
}

contract MockLaunchFactory {
    mapping(address => address) public launchOfToken;
    mapping(address => bool) public isLaunch;

    function add(address token, address launch) external {
        launchOfToken[token] = launch;
        isLaunch[launch] = true;
    }
}

contract MockFeeSource {
    address public platformFeeWallet;

    constructor(address w) {
        platformFeeWallet = w;
    }
}

contract Rejector {
    receive() external payable {
        revert("no");
    }
}
