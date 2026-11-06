// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundVaultInvest} from "../../src/fund/phase2/FundVaultInvest.sol";

contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "weth");
    }

    receive() external payable {}
}

/// @dev Buys: `tokensPerEth` token wei per 1e18 quote wei, after an optional ETH refund.
///      Sells: `ethPerToken` quote wei per 1e18 token wei, paid in ETH or in `assetOut` when that is a token.
contract RateRouter {
    uint256 public tokensPerEth;
    uint256 public ethPerToken;
    uint256 public refundBps;
    bytes public lastData;

    constructor(uint256 _tokensPerEth, uint256 _ethPerToken) {
        tokensPerEth = _tokensPerEth;
        ethPerToken = _ethPerToken;
    }

    function setRefundBps(uint256 bps) external {
        refundBps = bps;
    }

    function setEthPerToken(uint256 next) external {
        ethPerToken = next;
    }

    function swap(address, address assetOut, uint256 amountIn, uint256, bytes calldata data)
        external
        payable
        returns (uint256 amountOut)
    {
        lastData = data;
        if (msg.value > 0) {
            uint256 refund = (msg.value * refundBps) / 10_000;
            uint256 spent = msg.value - refund;
            amountOut = (spent * tokensPerEth) / 1e18;
            if (refund > 0) {
                (bool ok,) = msg.sender.call{value: refund}("");
                require(ok, "refund");
            }
            require(IERC20(assetOut).transfer(msg.sender, amountOut), "token");
            return amountOut;
        }
        amountOut = (amountIn * ethPerToken) / 1e18;
        if (assetOut == address(0)) {
            (bool ok,) = msg.sender.call{value: amountOut}("");
            require(ok, "eth");
            return amountOut;
        }
        require(IERC20(assetOut).transfer(msg.sender, amountOut), "token");
    }

    receive() external payable {}
}

contract FailRouter {
    function swap(address, address, uint256, uint256, bytes calldata) external payable returns (uint256) {
        revert("no");
    }
}

contract ThiefRouter {
    address public immutable thief;

    constructor(address _thief) {
        thief = _thief;
    }

    function swap(address, address, uint256, uint256, bytes calldata) external payable returns (uint256) {
        if (msg.value > 0) {
            (bool ok,) = thief.call{value: msg.value}("");
            require(ok, "steal");
        }
        return 0;
    }

    receive() external payable {}
}

contract ReenterRouter {
    FundVaultInvest public vault;
    bool public entered;
    uint256 public tokensPerEth = 1e18;

    function setVault(FundVaultInvest _vault) external {
        vault = _vault;
    }

    function swap(address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external
        payable
        returns (uint256 amountOut)
    {
        if (!entered) {
            entered = true;
            try vault.swap(address(this), assetIn, assetOut, amountIn, minAmountOut, data) {
                revert("reentered");
            } catch {}
        }
        amountOut = (msg.value * tokensPerEth) / 1e18;
        require(IERC20(assetOut).transfer(msg.sender, amountOut), "token");
    }

    receive() external payable {}
}
