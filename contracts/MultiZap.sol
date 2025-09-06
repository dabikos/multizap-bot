// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUniswapV2Router {
    function WETH() external pure returns (address);

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
    mapping(address => TokenInfo) public supportedTokens;
    address[] public tokenList;
    
    event TokenAdded(address indexed token, address indexed lpToken);
    event TokenRemoved(address indexed token);
    event TokenStatusChanged(address indexed token, bool isActive);

    constructor(address _router, address _factory) Ownable(msg.sender) {
        require(_router != address(0), "INVALID_ROUTER");
        require(_factory != address(0), "INVALID_FACTORY");
        router = IUniswapV2Router(_router);
        factory = IUniswapV2Factory(_factory);
    }

    /**
     * @dev Добавляет новый токен для работы
     * @param _token Адрес токена
     * @param _lpToken Адрес LP токена
     */
    function addToken(address _token, address _lpToken) external onlyOwner {
        require(_token != address(0), "INVALID_TOKEN");
        require(_lpToken != address(0), "INVALID_LP_TOKEN");
        require(supportedTokens[_token].token == address(0), "TOKEN_ALREADY_EXISTS");

        supportedTokens[_token] = TokenInfo({
            token: _token,
            lpToken: _lpToken,
            isActive: true
        });
        
        tokenList.push(_token);
        emit TokenAdded(_token, _lpToken);
    }

    /**
     * @dev Добавляет новый токен с автоматическим поиском LP токена
     * @param _token Адрес токена
     */
    function addTokenAuto(address _token) external onlyOwner {
        require(_token != address(0), "INVALID_TOKEN");
        require(supportedTokens[_token].token == address(0), "TOKEN_ALREADY_EXISTS");

        address weth = router.WETH();
        address lpToken = factory.getPair(_token, weth);
        require(lpToken != address(0), "LP_PAIR_NOT_FOUND");

        supportedTokens[_token] = TokenInfo({
            token: _token,
            lpToken: lpToken,
            isActive: true
        });
        
        tokenList.push(_token);
        emit TokenAdded(_token, lpToken);
    }

    /**
     * @dev Удаляет токен из списка поддерживаемых
     * @param _token Адрес токена
     */
    function removeToken(address _token) external onlyOwner {
        require(supportedTokens[_token].token != address(0), "TOKEN_NOT_FOUND");
        
        supportedTokens[_token].isActive = false;
        emit TokenRemoved(_token);
    }

    /**
     * @dev Изменяет статус токена (активен/неактивен)
     * @param _token Адрес токена
     * @param _isActive Новый статус
     */
    function setTokenStatus(address _token, bool _isActive) external onlyOwner {
        require(supportedTokens[_token].token != address(0), "TOKEN_NOT_FOUND");
        
        supportedTokens[_token].isActive = _isActive;
        emit TokenStatusChanged(_token, _isActive);
    }

    /**
     * @dev Получает информацию о токене
     * @param _token Адрес токена
     * @return tokenInfo Структура с информацией о токене
     */
    function getTokenInfo(address _token) external view returns (TokenInfo memory) {
        return supportedTokens[_token];
    }

    /**
     * @dev Получает список всех поддерживаемых токенов
     * @return tokens Массив адресов токенов
     */
    function getAllTokens() external view returns (address[] memory) {
        return tokenList;
    }

    /**
     * @dev Получает количество поддерживаемых токенов
     * @return count Количество токенов
     */
    function getTokenCount() external view returns (uint256) {
        return tokenList.length;
    }

    /**
     * @dev Выполняет zap-in для указанного токена
     * @param _token Адрес токена
     * @param amountOutMinToken Минимальное количество токенов при свопе
     * @param amountTokenMin Минимальное количество токенов при добавлении ликвидности
     * @param amountETHMin Минимальное количество ETH при добавлении ликвидности
     */
    function zapIn(
        address _token,
        uint amountOutMinToken,
        uint amountTokenMin,
        uint amountETHMin
    ) external payable onlyOwner {
        require(msg.value > 0, "NO_ETH");
        require(supportedTokens[_token].token != address(0), "TOKEN_NOT_SUPPORTED");
        require(supportedTokens[_token].isActive, "TOKEN_INACTIVE");

        uint half = msg.value / 2;
        uint otherHalf = msg.value - half;

        address[] memory path = new address[](2);
        path[0] = router.WETH();
        path[1] = _token;

        // Сначала свопаем половину ETH на токены
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: half}(
            amountOutMinToken,
            path,
            address(this),
            block.timestamp + 300
        );

        // Получаем баланс токенов после свопа
        uint tokenBal = IERC20(_token).balanceOf(address(this));
        require(tokenBal > 0, "NO_TOKENS_RECEIVED");

        // Даем разрешение роутеру на использование токенов
        IERC20(_token).approve(address(router), tokenBal);

        // Добавляем ликвидность
        router.addLiquidityETH{value: otherHalf}(
            _token,
            tokenBal,
            amountTokenMin,
            amountETHMin,
            address(this),
            block.timestamp + 300
        );
    }


    /**
     * @dev Выполняет exit и sell для указанного токена
     * @param _token Адрес токена
     * @param amountTokenMin Минимальное количество токенов при удалении ликвидности
     * @param amountETHMin Минимальное количество ETH при удалении ликвидности
     * @param amountOutMinETH Минимальное количество ETH при свопе токенов
     */
    function exitAndSell(
        address _token,
        uint amountTokenMin,
        uint amountETHMin,
        uint amountOutMinETH
    ) external onlyOwner {
        require(supportedTokens[_token].token != address(0), "TOKEN_NOT_SUPPORTED");
        
        address lpToken = supportedTokens[_token].lpToken;
        uint lpBal = IERC20(lpToken).balanceOf(address(this));
        require(lpBal > 0, "NO_LP");

        // Даем разрешение роутеру на использование LP токенов
        IERC20(lpToken).approve(address(router), lpBal);

        // Удаляем ликвидность
        router.removeLiquidityETHSupportingFeeOnTransferTokens(
            _token,
            lpBal,
            amountTokenMin,
            amountETHMin,
            address(this),
            block.timestamp + 300
        );

        // Получаем баланс токенов после удаления ликвидности
        uint tokenBal = IERC20(_token).balanceOf(address(this));
        if (tokenBal > 0) {
            address[] memory path = new address[](2);
            path[0] = _token;
            path[1] = router.WETH();

            // Даем разрешение роутеру на использование токенов
            IERC20(_token).approve(address(router), tokenBal);

            // Свопаем токены на ETH
            router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                tokenBal,
                amountOutMinETH,
                path,
                address(this),
                block.timestamp + 300
            );
        }

        // Переводим весь ETH владельцу
        payable(owner()).transfer(address(this).balance);
    }


    /**
     * @dev Получает баланс LP токена для указанного токена
     * @param _token Адрес токена
     * @return balance Баланс LP токена
     */
    function getLpBalance(address _token) external view returns (uint256) {
        require(supportedTokens[_token].token != address(0), "TOKEN_NOT_SUPPORTED");
        return IERC20(supportedTokens[_token].lpToken).balanceOf(address(this));
    }

    /**
     * @dev Получает баланс токена в контракте
     * @param _token Адрес токена
     * @return balance Баланс токена
     */
    function getTokenBalance(address _token) external view returns (uint256) {
        return IERC20(_token).balanceOf(address(this));
    }


    receive() external payable {}
}
