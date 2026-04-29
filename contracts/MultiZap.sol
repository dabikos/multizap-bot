// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUniswapV2Router {
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable;

    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity);

    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint amountETH);

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

contract MultiZap is Ownable {
    using SafeERC20 for IERC20;

    struct TokenInfo {
        address token;
        address lpToken;
        bool isActive;
    }

    IUniswapV2Router public router;
    IUniswapV2Factory public factory;
    address public wethAddress;

    mapping(address => TokenInfo) public supportedTokens;
    address[] public tokenList;

    event TokenAdded(address indexed token, address indexed lpToken);
    event TokenRemoved(address indexed token);

    constructor(address _router, address _factory, address _wethAddress) Ownable(msg.sender) {
        require(_router != address(0), "INVALID_ROUTER");
        require(_factory != address(0), "INVALID_FACTORY");
        require(_wethAddress != address(0), "INVALID_WETH");

        router = IUniswapV2Router(_router);
        factory = IUniswapV2Factory(_factory);
        wethAddress = _wethAddress;
    }

    receive() external payable {}

    function _findPair(address _token) internal view returns (address) {
        if (_token < wethAddress) {
            return factory.getPair(_token, wethAddress);
        }
        return factory.getPair(wethAddress, _token);
    }

    function _storeSupportedToken(address _token, address _lpToken) internal {
        supportedTokens[_token] = TokenInfo({
            token: _token,
            lpToken: _lpToken,
            isActive: true
        });

        tokenList.push(_token);
        emit TokenAdded(_token, _lpToken);
    }

    function _resolveLpToken(address _token) internal view returns (address lpToken) {
        TokenInfo memory tokenInfo = supportedTokens[_token];
        require(tokenInfo.token != address(0), "TOKEN_NOT_SUPPORTED");
        require(tokenInfo.isActive, "TOKEN_INACTIVE");

        lpToken = _findPair(_token);
        require(lpToken != address(0), "LP_PAIR_NOT_FOUND");
    }

    function _resolveOrAddToken(address _token) internal {
        TokenInfo memory tokenInfo = supportedTokens[_token];
        if (tokenInfo.token != address(0)) {
            require(tokenInfo.isActive, "TOKEN_INACTIVE");
            return;
        }

        address lpToken = _findPair(_token);
        require(lpToken != address(0), "LP_PAIR_NOT_FOUND");
        _storeSupportedToken(_token, lpToken);
    }

    function _zapIn(
        address _token,
        uint amountOutMinToken,
        uint amountTokenMin,
        uint amountETHMin
    ) internal {
        require(msg.value > 0, "NO_ETH");

        TokenInfo memory tokenInfo = supportedTokens[_token];
        require(tokenInfo.token != address(0), "TOKEN_NOT_SUPPORTED");
        require(tokenInfo.isActive, "TOKEN_INACTIVE");

        uint prefund = 1;
        (bool prefundSent,) = _token.call{value: prefund}("");
        uint remaining = prefundSent ? msg.value - prefund : msg.value;
        uint half = remaining / 2;
        uint otherHalf = remaining - half;

        address[] memory path = new address[](2);
        path[0] = wethAddress;
        path[1] = _token;

        uint tokenBalanceBefore = IERC20(_token).balanceOf(address(this));

        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: half}(
            amountOutMinToken,
            path,
            address(this),
            block.timestamp + 300
        );

        uint tokenBalance = IERC20(_token).balanceOf(address(this)) - tokenBalanceBefore;
        require(tokenBalance > 0, "NO_TOKENS_RECEIVED");

        IERC20(_token).forceApprove(address(router), type(uint256).max);

        try router.addLiquidityETH{value: otherHalf}(
            _token,
            tokenBalance,
            amountTokenMin,
            amountETHMin,
            address(this),
            block.timestamp + 300
        ) returns (uint, uint, uint) {
        } catch Error(string memory reason) {
            revert(string(abi.encodePacked("ADD_LIQ_FAILED: ", reason)));
        } catch {
            revert("ADD_LIQ_FAILED_UNKNOWN");
        }
    }

    function addTokenAuto(address _token) external onlyOwner {
        require(_token != address(0), "INVALID_TOKEN");
        require(supportedTokens[_token].token == address(0), "TOKEN_ALREADY_EXISTS");

        address lpToken = _findPair(_token);
        require(lpToken != address(0), "LP_PAIR_NOT_FOUND");
        _storeSupportedToken(_token, lpToken);
    }

    function removeToken(address _token) external onlyOwner {
        require(supportedTokens[_token].token != address(0), "TOKEN_NOT_FOUND");
        delete supportedTokens[_token];

        uint256 length = tokenList.length;
        for (uint256 i = 0; i < length; i++) {
            if (tokenList[i] == _token) {
                tokenList[i] = tokenList[length - 1];
                tokenList.pop();
                break;
            }
        }

        emit TokenRemoved(_token);
    }

    function getTokenInfo(address _token) external view returns (TokenInfo memory) {
        return supportedTokens[_token];
    }

    function getAllTokens() external view returns (address[] memory) {
        return tokenList;
    }

    function getTokenCount() external view returns (uint256) {
        return tokenList.length;
    }

    function zapIn(
        address _token,
        uint amountOutMinToken,
        uint amountTokenMin,
        uint amountETHMin
    ) external payable onlyOwner {
        _zapIn(_token, amountOutMinToken, amountTokenMin, amountETHMin);
    }

    function addTokenAndZapIn(
        address _token,
        uint amountOutMinToken,
        uint amountTokenMin,
        uint amountETHMin
    ) external payable onlyOwner {
        _resolveOrAddToken(_token);
        _zapIn(_token, amountOutMinToken, amountTokenMin, amountETHMin);
    }

    function exitAndSell(
        address _token,
        uint amountTokenMin,
        uint amountETHMin,
        uint amountOutMinETH
    ) external onlyOwner {
        address lpToken = _resolveLpToken(_token);
        uint lpBalance = IERC20(lpToken).balanceOf(address(this));
        require(lpBalance > 0, "NO_LP");

        IERC20(lpToken).forceApprove(address(router), lpBalance);

        uint tokenBalanceBefore = IERC20(_token).balanceOf(address(this));

        router.removeLiquidityETHSupportingFeeOnTransferTokens(
            _token,
            lpBalance,
            amountTokenMin,
            amountETHMin,
            address(this),
            block.timestamp + 300
        );

        uint tokenBalance = IERC20(_token).balanceOf(address(this)) - tokenBalanceBefore;
        if (tokenBalance > 0) {
            address[] memory path = new address[](2);
            path[0] = _token;
            path[1] = wethAddress;

            IERC20(_token).forceApprove(address(router), tokenBalance);
            router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                tokenBalance,
                amountOutMinETH,
                path,
                address(this),
                block.timestamp + 300
            );
        }

        uint finalEthBalance = address(this).balance;
        require(finalEthBalance > 0, "NO_ETH_RECEIVED");
        (bool success,) = payable(owner()).call{value: finalEthBalance}("");
        require(success, "ETH_TRANSFER_FAILED");
    }

    function getLpBalance(address _token) external view returns (uint256) {
        if (supportedTokens[_token].token == address(0)) {
            return 0;
        }

        address lpToken = _findPair(_token);
        return lpToken == address(0) ? 0 : IERC20(lpToken).balanceOf(address(this));
    }

    function getTokenBalance(address _token) external view returns (uint256) {
        return IERC20(_token).balanceOf(address(this));
    }
}
