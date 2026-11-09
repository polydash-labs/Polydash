// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundVaultInvest} from "../../src/fund/phase2/FundVaultInvest.sol";

/// @dev `priceX18` is ETH wei per 1e18 raw token units. Unpinned reads use the current timestamp.
contract MockFeed {
    uint256 public priceX18 = 1e18;
    uint64 public updatedAt;
    bool public pin;

    constructor() {
        updatedAt = uint64(block.timestamp);
    }

    function setPrice(uint256 next) external {
        priceX18 = next;
        if (!pin) updatedAt = uint64(block.timestamp);
    }

    function pinAt(uint64 stamp) external {
        pin = true;
        updatedAt = stamp;
    }

    function latestPrice(address) external view returns (uint256, uint64) {
        return (priceX18, pin ? updatedAt : uint64(block.timestamp));
    }
}

/// @dev Transfers succeed until `lock` is called. Used to show a later exit can still pay ETH.
contract GateToken is ERC20 {
    bool public locked;

    constructor() ERC20("Gate", "GATE") {
        _mint(msg.sender, 1e24);
    }

    function lock() external {
        locked = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (locked && from != address(0)) revert("locked");
        super._update(from, to, value);
    }
}

/// @dev Takes `feeBps` from each holder-to-holder transfer. Mint and burn are not taxed.
contract TaxToken is ERC20 {
    uint256 public immutable feeBps;
    address public constant SINK = address(0xFEE);

    constructor(uint256 _feeBps) ERC20("Tax", "TAX") {
        feeBps = _feeBps;
        _mint(msg.sender, 1e24);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (feeBps == 0 || from == address(0) || to == address(0) || value == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        super._update(from, to, value - fee);
        if (fee != 0) super._update(from, SINK, fee);
    }
}

/// @dev Optional 1 wei shortfall on deposit or withdraw. Used to lock the 1:1 quote rule.
contract SkewWETH is ERC20 {
    bool public shortDeposit;
    bool public shortWithdraw;

    constructor() ERC20("Skew", "sWETH") {}

    function setShort(bool depositShort, bool withdrawShort) external {
        shortDeposit = depositShort;
        shortWithdraw = withdrawShort;
    }

    function deposit() external payable {
        uint256 minted = shortDeposit && msg.value > 1 ? msg.value - 1 : msg.value;
        _mint(msg.sender, minted);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        uint256 out = shortWithdraw && amount > 1 ? amount - 1 : amount;
        (bool ok,) = msg.sender.call{value: out}("");
        require(ok, "weth");
    }

    receive() external payable {}
}

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

/// @dev Minimal SwapRouter02 stand-in: exactInputSingle at a fixed rate, WETH9() returns the WETH.
///      Pulls tokenIn from the caller and pays tokenOut to the recipient. Fund it before use.
contract MockSwapRouter02 {
    address public immutable weth;
    uint256 public tokensPerEth;
    uint256 public ethPerToken;
    uint24 public lastFee;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    constructor(address _weth, uint256 _tokensPerEth, uint256 _ethPerToken) {
        weth = _weth;
        tokensPerEth = _tokensPerEth;
        ethPerToken = _ethPerToken;
    }

    function WETH9() external view returns (address) {
        return weth;
    }

    function setEthPerToken(uint256 next) external {
        ethPerToken = next;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        lastFee = params.fee;
        require(IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn), "pull");
        if (params.tokenIn == weth) {
            amountOut = (params.amountIn * tokensPerEth) / 1e18;
        } else {
            amountOut = (params.amountIn * ethPerToken) / 1e18;
        }
        require(amountOut >= params.amountOutMinimum, "min");
        require(IERC20(params.tokenOut).transfer(params.recipient, amountOut), "pay");
    }
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
