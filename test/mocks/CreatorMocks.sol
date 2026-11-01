// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockERC20 is ERC20 {
    constructor(string memory n) ERC20(n, n) {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// @dev Takes `feeBps` from every transfer (burned).
contract FeeERC20 is ERC20 {
    uint256 public feeBps;

    constructor(uint256 f) ERC20("FEE", "FEE") {
        feeBps = f;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function _update(address from, address to, uint256 v) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = v * feeBps / 10_000;
            super._update(from, address(0), fee);
            v -= fee;
        }
        super._update(from, to, v);
    }
}

interface IHook {
    function onHook() external;
}

/// @dev Calls a hook on the recipient during transfers (ERC777-style) for reentrancy tests.
contract HookERC20 is ERC20 {
    address public hookTarget;
    constructor() ERC20("HOOK", "HOOK") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function setHook(address t) external {
        hookTarget = t;
    }

    function _update(address from, address to, uint256 v) internal override {
        super._update(from, to, v);
        if (to == hookTarget && hookTarget != address(0) && from != address(0)) IHook(to).onHook();
    }
}

/// @dev Minimal Polypad-like collection: owner-only burn ("redeem").
contract MockCollection is ERC721 {
    uint256 public next;
    constructor() ERC721("Polycat", "PCAT") {}

    function mint(address to, uint256 n) external {
        for (uint256 i; i < n; ++i) {
            _mint(to, ++next);
        }
    }

    function safeMintTo(address to) external {
        _safeMint(to, ++next);
    }

    function redeem(uint256[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) {
            require(_ownerOf(ids[i]) == msg.sender, "NotOwner");
            _burn(ids[i]);
        }
    }
}

contract MockCollectionFactory {
    mapping(address => bool) public isCollection;

    function set(address c, bool v) external {
        isCollection[c] = v;
    }
}

contract MockLaunchFactory {
    mapping(address => address) public launchOfToken;

    function set(address t, address l) external {
        launchOfToken[t] = l;
    }
}
