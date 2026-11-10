// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IPhase5Lock, IPhase5Registry, IPhase5Share, IPhase5Vault, Phase5Fund} from "./IPhase5.sol";

/// @title FundShareRenderer
/// @notice On-chain SVG for a Phase 3 share. `FundNFTPhase3.tokenURI` has no external hook, so indexers
///         read `tokenURI(nft, tokenId)` here. The drawing uses #000000 and #ffffff only.
///         Figures are the vault's `navPerNft`, the share's stored mint price, and the drawdown brake.
///         A feed that cannot be read is labelled unavailable. Not a market quote.
///         Not audited. Not a review. Not financial advice.
contract FundShareRenderer {
    using Strings for uint256;

    uint256 internal constant BPS = 10_000;

    struct Card {
        string name;
        string token;
        string navText;
        string changeText;
        string brakeText;
        string lockText;
    }

    address public immutable factory;
    address public immutable registry;

    error ZeroAddress();

    constructor(address phase3Factory, address phase5Registry) {
        if (phase3Factory == address(0) || phase5Registry == address(0)) revert ZeroAddress();
        factory = phase3Factory;
        registry = phase5Registry;
    }

    function tokenURI(address nft, uint256 tokenId) external view returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(metadata(nft, tokenId))));
    }

    function metadata(address nft, uint256 tokenId) public view returns (string memory) {
        Card memory card = _card(nft, tokenId);
        string memory image = Base64.encode(bytes(_svg(card)));
        return string.concat(
            '{"name":"',
            _json(card.name),
            " #",
            card.token,
            '","description":"On-chain share art for a tokenized fund. The figures are vault readings and the stored mint price. Not financial advice.","image":"data:image/svg+xml;base64,',
            image,
            '","attributes":[',
            _attr("NAV per share", card.navText),
            ",",
            _attr("Change vs mint bps", card.changeText),
            ",",
            _attr("Drawdown brake", card.brakeText),
            ",",
            _attr("Lock tier", card.lockText),
            "]}"
        );
    }

    function svg(address nft, uint256 tokenId) external view returns (string memory) {
        return _svg(_card(nft, tokenId));
    }

    /// @notice Change from `start` to `end`, in basis points. Zero when `start` is zero.
    function changeBps(uint256 end, uint256 start) public pure returns (int256) {
        if (start == 0) return 0;
        if (end >= start) {
            uint256 delta = end - start;
            if (delta > type(uint256).max / BPS) return type(int256).max;
            uint256 up = (delta * BPS) / start;
            if (up > uint256(type(int256).max)) return type(int256).max;
            return int256(up);
        }
        uint256 drop = start - end;
        if (drop > type(uint256).max / BPS) return type(int256).min;
        uint256 down = (drop * BPS) / start;
        if (down > uint256(type(int256).max)) return type(int256).min;
        return -int256(down);
    }

    function formatEth(uint256 amount) public pure returns (string memory) {
        uint256 whole = amount / 1e18;
        uint256 frac = (amount % 1e18) / 1e12;
        return string.concat(whole.toString(), ".", _pad6(frac));
    }

    function _card(address nft, uint256 tokenId) internal view returns (Card memory card) {
        address vault = Phase5Fund.vaultOf(factory, nft);
        if (vault == address(0)) revert ZeroAddress();
        address holder = IPhase5Share(nft).ownerOf(tokenId);
        if (holder == address(0)) revert ZeroAddress();
        card.name = IPhase5Share(nft).name();
        card.token = tokenId.toString();
        uint256 tier = IPhase5Lock(IPhase5Registry(registry).locks()).tierOf(nft, tokenId);
        card.lockText = tier == 0 ? "0" : tier.toString();
        (card.navText, card.changeText, card.brakeText) = _readings(vault, IPhase5Share(nft).mintPrice());
    }

    function _readings(address vault, uint256 mintPrice)
        internal
        view
        returns (string memory navText, string memory changeText, string memory brakeText)
    {
        bool navOk = false;
        uint256 perShare = 0;
        try IPhase5Vault(vault).navPerNft() returns (uint256 value) {
            navOk = true;
            perShare = value;
        } catch {
            navOk = false;
        }
        uint256 maxDrawdown = 0;
        bool capOk = false;
        try IPhase5Vault(vault).maxDrawdownBps() returns (uint256 value) {
            capOk = true;
            maxDrawdown = value;
        } catch {
            capOk = false;
        }
        if (!navOk) {
            navText = "UNAVAILABLE";
            changeText = "UNAVAILABLE";
        } else {
            navText = string.concat(formatEth(perShare), " ETH");
            changeText = string.concat(_signed(changeBps(perShare, mintPrice)), " BPS");
        }
        if (!capOk) {
            brakeText = "UNREAD";
        } else if (maxDrawdown == 0) {
            brakeText = "UNSET";
        } else if (!navOk) {
            brakeText = "UNREAD";
        } else if (Phase5Fund.brakeActive(vault)) {
            brakeText = "ON";
        } else {
            brakeText = "OFF";
        }
    }

    function _svg(Card memory card) internal pure returns (string memory) {
        string memory badgeFill = _eq(card.brakeText, "ON") ? "#000000" : "#ffffff";
        string memory badgeInk = _eq(card.brakeText, "ON") ? "#ffffff" : "#000000";
        string memory badgeStroke = _eq(card.brakeText, "ON") ? "" : ' stroke="#000000"';
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480">',
            '<rect width="480" height="480" fill="#ffffff"/>',
            '<rect x="24" y="24" width="432" height="432" fill="#ffffff" stroke="#000000" stroke-width="4"/>',
            _text(48, 78, 28, _xml(card.name)),
            _text(48, 130, 14, "NAV PER SHARE"),
            _text(48, 168, 26, _xml(card.navText)),
            _text(48, 214, 14, "CHANGE VS MINT"),
            _text(48, 250, 26, _xml(card.changeText)),
            _text(48, 300, 14, "DRAWDOWN BRAKE"),
            '<rect x="48" y="316" width="140" height="36" fill="',
            badgeFill,
            '"',
            badgeStroke,
            "/>",
            '<text x="64" y="340" fill="',
            badgeInk,
            '" font-size="16" font-family="monospace">',
            card.brakeText,
            "</text>",
            _text(48, 400, 14, string.concat("LOCK ", card.lockText)),
            _text(48, 432, 12, string.concat("ID ", card.token)),
            "</svg>"
        );
    }

    function _text(uint256 x, uint256 y, uint256 size, string memory body) internal pure returns (string memory) {
        return string.concat(
            '<text x="',
            x.toString(),
            '" y="',
            y.toString(),
            '" fill="#000000" font-size="',
            size.toString(),
            '" font-family="monospace">',
            body,
            "</text>"
        );
    }

    function _attr(string memory trait, string memory value) internal pure returns (string memory) {
        return string.concat('{"trait_type":"', trait, '","value":"', _json(value), '"}');
    }

    function _signed(int256 value) internal pure returns (string memory) {
        if (value < 0) {
            uint256 mag =
                value == type(int256).min ? uint256(type(int256).max) + 1 : uint256(-value);
            return string.concat("-", mag.toString());
        }
        return string.concat("+", uint256(value).toString());
    }

    function _pad6(uint256 frac) internal pure returns (string memory) {
        bytes memory raw = bytes(frac.toString());
        bytes memory out = new bytes(6);
        uint256 pad = raw.length >= 6 ? 0 : 6 - raw.length;
        for (uint256 i; i < 6; ++i) {
            out[i] = i < pad ? bytes1("0") : raw[i - pad];
        }
        return string(out);
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _xml(string memory input) internal pure returns (string memory) {
        bytes memory raw = bytes(input);
        uint256 extra = 0;
        for (uint256 i; i < raw.length; ++i) {
            bytes1 c = raw[i];
            if (c == "&") extra += 4;
            else if (c == "<" || c == ">") extra += 3;
        }
        if (extra == 0) return input;
        bytes memory out = new bytes(raw.length + extra);
        uint256 j = 0;
        for (uint256 i; i < raw.length; ++i) {
            bytes1 c = raw[i];
            if (c == "&") {
                out[j++] = "&";
                out[j++] = "a";
                out[j++] = "m";
                out[j++] = "p";
                out[j++] = ";";
            } else if (c == "<") {
                out[j++] = "&";
                out[j++] = "l";
                out[j++] = "t";
                out[j++] = ";";
            } else if (c == ">") {
                out[j++] = "&";
                out[j++] = "g";
                out[j++] = "t";
                out[j++] = ";";
            } else {
                out[j++] = c;
            }
        }
        return string(out);
    }

    function _json(string memory input) internal pure returns (string memory) {
        bytes memory raw = bytes(input);
        uint256 extra = 0;
        for (uint256 i; i < raw.length; ++i) {
            bytes1 c = raw[i];
            if (c == "\\" || c == '"') extra += 1;
        }
        if (extra == 0) return input;
        bytes memory out = new bytes(raw.length + extra);
        uint256 j = 0;
        for (uint256 i; i < raw.length; ++i) {
            bytes1 c = raw[i];
            if (c == "\\" || c == '"') out[j++] = "\\";
            out[j++] = c;
        }
        return string(out);
    }
}
