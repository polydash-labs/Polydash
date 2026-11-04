// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

contract MockToken is ERC20 {
    address public reenterTarget;
    bytes public reenterData;
    bool public reenterSucceeded;
    uint256 public reenterAttempts;
    constructor() ERC20("Polydash", "POLYDASH") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function setReenter(address t, bytes calldata d) external {
        reenterTarget = t;
        reenterData = d;
    }

    function _update(address f, address t, uint256 v) internal override {
        super._update(f, t, v);
        address r = reenterTarget;
        if (r != address(0) && t == 0x000000000000000000000000000000000000dEaD) {
            reenterAttempts++;
            reenterTarget = address(0);
            (bool ok,) = r.call(reenterData);
            if (ok) reenterSucceeded = true;
            reenterTarget = r;
        }
    }
}

interface IBuyback {
    function buyback() external payable returns (uint256);
}

/// Mirrors PolydashFactory.collectPlatformFees' buyback call (try/catch, all gas).
contract MockLaunchFactory {
    event BuybackFailed(uint256 amount);
    uint256 public failed;

    function send(address vault, uint256 amt) external payable {
        try IBuyback(vault).buyback{value: amt}() {}
        catch {
            failed += amt;
            emit BuybackFailed(amt);
        }
    }
    receive() external payable {}
}

contract StipendSender {
    function viaTransfer(address payable to) external payable {
        to.transfer(msg.value);
    }

    function viaSend(address payable to) external payable returns (bool) {
        return to.send(msg.value);
    }
}

contract Reenterer {
    address public target;
    bytes public data;
    bool public ok;
    uint256 public n;

    function setup(address t, bytes calldata d) external {
        target = t;
        data = d;
    }

    function go(address to, uint256 v, bytes calldata d) external payable {
        (bool s, bytes memory r) = to.call{value: v}(d);
        if (!s) {
            assembly { revert(add(r, 32), mload(r)) }
        }
    }

    receive() external payable {
        if (n == 0) {
            n++;
            (ok,) = target.call(data);
        }
    }
}

contract MockStakingFactory {
    mapping(address => bool) public isPool;

    function add(address p) external {
        isPool[p] = true;
    }
}

/// Minimal top-up-capable rewards pool (what a target must look like).
contract MockRewardsPool {
    address public stakeToken;
    address public rewardToken;
    uint256 public endTime;
    uint256 public notified;
    bool public pullLess;
    bool public revertNotify;

    constructor(address s, address r, uint256 e) {
        stakeToken = s;
        rewardToken = r;
        endTime = e;
    }

    function setEnd(uint256 e) external {
        endTime = e;
    }

    function acceptsRewardTopUps() external pure returns (bool) {
        return true;
    }

    function setPullLess(bool b) external {
        pullLess = b;
    }

    function setRevert(bool b) external {
        revertNotify = b;
    }

    function notifyRewardAmount(uint256 a) external {
        require(!revertNotify, "nope");
        uint256 take = pullLess ? a / 2 : a;
        ERC20(rewardToken).transferFrom(msg.sender, address(this), take);
        notified += take;
    }
}

/// @dev Same external surface as a live PolydashStakingPoolV2 for the checks the vault performs: POLYDASH stake and
/// reward token, a finite end time, funded once at creation, no acceptsRewardTopUps() and no notifyRewardAmount().
/// The real V2 pool on mainnet is exercised in test/fork/BuybackFork.t.sol.
contract MockV2Pool {
    address public stakeToken;
    address public rewardToken;
    uint256 public endTime;

    constructor(address token, uint256 end) {
        stakeToken = token;
        rewardToken = token;
        endTime = end;
    }
}
