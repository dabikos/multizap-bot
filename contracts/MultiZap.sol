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

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity);

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);

    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint amountETH);

    function removeLiquiditySupportingFeeOnTransferTokens(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB);

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
        address baseToken;  // WBNB или USDT
        bool isActive;
    }

    IUniswapV2Router public router;
    IUniswapV2Factory public factory;
    address public usdtAddress;  // Адрес USDT токена
    mapping(address => TokenInfo) public supportedTokens;
    address[] public tokenList;
    
    event TokenAdded(address indexed token, address indexed lpToken, address indexed baseToken);
    event TokenRemoved(address indexed token);
    event TokenStatusChanged(address indexed token, bool isActive);
    event LiquidityWithdrawn(address indexed token, uint256 lpAmount, uint256 tokenAmount, uint256 nativeAmount);
    event USDTAddressSet(address indexed usdtAddress);

    constructor(address _router, address _factory, address _usdtAddress) Ownable(msg.sender) {
        require(_router != address(0), "INVALID_ROUTER");
        require(_factory != address(0), "INVALID_FACTORY");
        router = IUniswapV2Router(_router);
        factory = IUniswapV2Factory(_factory);
        usdtAddress = _usdtAddress;
    }

    /**
     * @dev Устанавливает адрес USDT токена
     */
    function setUSDTAddress(address _usdtAddress) external onlyOwner {
        require(_usdtAddress != address(0), "INVALID_USDT_ADDRESS");
        usdtAddress = _usdtAddress;
        emit USDTAddressSet(_usdtAddress);
    }

    /**
     * @dev Добавляет новый токен для работы
     * @param _token Адрес токена
     * @param _lpToken Адрес LP токена
     * @param _baseToken Адрес базового токена (WBNB или USDT)
     */
    function addToken(address _token, address _lpToken, address _baseToken) external onlyOwner {
        require(_token != address(0), "INVALID_TOKEN");
        require(_lpToken != address(0), "INVALID_LP_TOKEN");
        require(_baseToken != address(0), "INVALID_BASE_TOKEN");
        address wbnb = router.WETH();
        require(_baseToken == wbnb || _baseToken == usdtAddress, "INVALID_BASE_TOKEN");
        require(supportedTokens[_token].token == address(0), "TOKEN_ALREADY_EXISTS");

        supportedTokens[_token] = TokenInfo({
            token: _token,
            lpToken: _lpToken,
            baseToken: _baseToken,
            isActive: true
        });
        
        tokenList.push(_token);
        emit TokenAdded(_token, _lpToken, _baseToken);
    }

    /**
     * @dev Добавляет новый токен с автоматическим поиском LP токена
     * @param _token Адрес токена
     * @param _useUSDT true для USDT пары, false для WBNB пары
     */
    function addTokenAuto(address _token, bool _useUSDT) external onlyOwner {
        require(_token != address(0), "INVALID_TOKEN");
        require(supportedTokens[_token].token == address(0), "TOKEN_ALREADY_EXISTS");

        address baseToken = _useUSDT ? usdtAddress : router.WETH();
        require(baseToken != address(0), "BASE_TOKEN_NOT_SET");
        
        address lpToken = factory.getPair(_token, baseToken);
        require(lpToken != address(0), "LP_PAIR_NOT_FOUND");

        supportedTokens[_token] = TokenInfo({
            token: _token,
            lpToken: lpToken,
            baseToken: baseToken,
            isActive: true
        });
        
        tokenList.push(_token);
        emit TokenAdded(_token, lpToken, baseToken);
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
     * @dev Выполняет zap-in для указанного токена (работает с WBNB и USDT)
     * @param _token Адрес токена
     * @param amountOutMinToken Минимальное количество токенов при свопе
     * @param amountTokenMin Минимальное количество токенов при добавлении ликвидности
     * @param amountBNBMin Минимальное количество BNB при добавлении ликвидности
     */
    function zapIn(
        address _token,
        uint amountOutMinToken,
        uint amountTokenMin,
        uint amountBNBMin
    ) external payable onlyOwner {
        require(msg.value > 0, "NO_BNB");
        require(supportedTokens[_token].token != address(0), "TOKEN_NOT_SUPPORTED");
        require(supportedTokens[_token].isActive, "TOKEN_INACTIVE");

        TokenInfo memory tokenInfo = supportedTokens[_token];
        address baseToken = tokenInfo.baseToken;
        address wbnb = router.WETH();

        if (baseToken == wbnb) {
            // WBNB пара - существующая логика
            uint half = msg.value / 2;
            uint otherHalf = msg.value - half;

            address[] memory path = new address[](2);
            path[0] = wbnb;
            path[1] = _token;

            // Сначала свопаем половину BNB на токены
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
                amountBNBMin,
                address(this),
                block.timestamp + 300
            );
        } else {
            // USDT пара - новая логика
            require(baseToken == usdtAddress, "INVALID_BASE_TOKEN");
            
            // Свопаем весь BNB на USDT
            address[] memory pathBNBtoUSDT = new address[](2);
            pathBNBtoUSDT[0] = wbnb;
            pathBNBtoUSDT[1] = usdtAddress;

            router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(
                0,
                pathBNBtoUSDT,
                address(this),
                block.timestamp + 300
            );

            uint usdtBal = IERC20(usdtAddress).balanceOf(address(this));
            require(usdtBal > 0, "NO_USDT_RECEIVED");

            uint halfUSDT = usdtBal / 2;
            uint otherHalfUSDT = usdtBal - halfUSDT;

            // Свопаем половину USDT на токен
            address[] memory pathUSDTtoToken = new address[](2);
            pathUSDTtoToken[0] = usdtAddress;
            pathUSDTtoToken[1] = _token;

            IERC20(usdtAddress).approve(address(router), halfUSDT);
            router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                halfUSDT,
                amountOutMinToken,
                pathUSDTtoToken,
                address(this),
                block.timestamp + 300
            );

            uint tokenBal = IERC20(_token).balanceOf(address(this));
            require(tokenBal > 0, "NO_TOKENS_RECEIVED");

            // Добавляем ликвидность Token/USDT
            IERC20(_token).approve(address(router), tokenBal);
            IERC20(usdtAddress).approve(address(router), otherHalfUSDT);

            router.addLiquidity(
                _token,
                usdtAddress,
                tokenBal,
                otherHalfUSDT,
                amountTokenMin,
                0,  // amountUSDTMin - 0 для гибкости
                address(this),
                block.timestamp + 300
            );
        }
    }


    /**
     * @dev Выполняет exit и sell для указанного токена (работает с WBNB и USDT)
     * @param _token Адрес токена
     * @param amountTokenMin Минимальное количество токенов при удалении ликвидности
     * @param amountBNBMin Минимальное количество BNB при удалении ликвидности
     * @param amountOutMinBNB Минимальное количество BNB при свопе токенов
     */
    function exitAndSell(
        address _token,
        uint amountTokenMin,
        uint amountBNBMin,
        uint amountOutMinBNB
    ) external onlyOwner {
        require(supportedTokens[_token].token != address(0), "TOKEN_NOT_SUPPORTED");
        
        TokenInfo memory tokenInfo = supportedTokens[_token];
        address lpToken = tokenInfo.lpToken;
        address baseToken = tokenInfo.baseToken;
        address wbnb = router.WETH();
        uint lpBal = IERC20(lpToken).balanceOf(address(this));
        require(lpBal > 0, "NO_LP");

        // Даем разрешение роутеру на использование LP токенов
        IERC20(lpToken).approve(address(router), lpBal);

        if (baseToken == wbnb) {
            // WBNB пара - существующая логика
            // Удаляем ликвидность
            router.removeLiquidityETHSupportingFeeOnTransferTokens(
                _token,
                lpBal,
                amountTokenMin,
                amountBNBMin,
                address(this),
                block.timestamp + 300
            );

            // Получаем баланс токенов после удаления ликвидности
            uint tokenBal = IERC20(_token).balanceOf(address(this));
            if (tokenBal > 0) {
                address[] memory path = new address[](2);
                path[0] = _token;
                path[1] = wbnb;

                // Даем разрешение роутеру на использование токенов
                IERC20(_token).approve(address(router), tokenBal);

                // Свопаем токены на BNB
                router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                    tokenBal,
                    amountOutMinBNB,
                    path,
                    address(this),
                    block.timestamp + 300
                );
            }

            // Переводим весь BNB владельцу
            uint finalBNBBal = address(this).balance;
            require(finalBNBBal > 0, "NO_BNB_RECEIVED");
            (bool success, ) = payable(owner()).call{value: finalBNBBal}("");
            require(success, "BNB_TRANSFER_FAILED");
        } else {
            // USDT пара - новая логика
            require(baseToken == usdtAddress, "INVALID_BASE_TOKEN");

            // Определяем правильный порядок токенов (tokenA < tokenB)
            address tokenA;
            address tokenB;
            bool tokenFirst;
            if (_token < usdtAddress) {
                tokenA = _token;
                tokenB = usdtAddress;
                tokenFirst = true;
            } else {
                tokenA = usdtAddress;
                tokenB = _token;
                tokenFirst = false;
            }

            // Удаляем ликвидность с правильным порядком токенов
            router.removeLiquiditySupportingFeeOnTransferTokens(
                tokenA,
                tokenB,
                lpBal,
                tokenFirst ? amountTokenMin : 0,  // amountAMin
                tokenFirst ? 0 : amountTokenMin,   // amountBMin (для USDT используем 0)
                address(this),
                block.timestamp + 300
            );

            // Проверяем балансы после удаления ликвидности
            uint tokenBal = IERC20(_token).balanceOf(address(this));
            uint usdtBal = IERC20(usdtAddress).balanceOf(address(this));

            require(tokenBal > 0 || usdtBal > 0, "NO_LIQUIDITY_RECEIVED");

            // Свопаем токены на USDT (если есть токены)
            if (tokenBal > 0) {
                address[] memory pathTokenToUSDT = new address[](2);
                pathTokenToUSDT[0] = _token;
                pathTokenToUSDT[1] = usdtAddress;

                IERC20(_token).approve(address(router), tokenBal);
                router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    tokenBal,
                    0,
                    pathTokenToUSDT,
                    address(this),
                    block.timestamp + 300
                );
                
                // Обновляем баланс USDT после свопа
                usdtBal = IERC20(usdtAddress).balanceOf(address(this));
            }

            // Свопаем весь USDT на BNB
            require(usdtBal > 0, "NO_USDT_TO_SWAP");
            address[] memory pathUSDTtoBNB = new address[](2);
            pathUSDTtoBNB[0] = usdtAddress;
            pathUSDTtoBNB[1] = wbnb;

            IERC20(usdtAddress).approve(address(router), usdtBal);
            router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                usdtBal,
                amountOutMinBNB,
                pathUSDTtoBNB,
                address(this),
                block.timestamp + 300
            );

            // Переводим весь BNB владельцу
            uint finalBNBBal = address(this).balance;
            require(finalBNBBal > 0, "NO_BNB_RECEIVED");
            (bool success, ) = payable(owner()).call{value: finalBNBBal}("");
            require(success, "BNB_TRANSFER_FAILED");
        }
    }

    /**
     * @dev Снимает ликвидность без продажи токена (работает с WBNB и USDT)
     * @param _token Адрес токена
     */
    function withdrawLiquidity(address _token) external onlyOwner {
        TokenInfo storage info = supportedTokens[_token];
        require(info.token != address(0), "TOKEN_NOT_SUPPORTED");
        require(info.isActive, "TOKEN_INACTIVE");

        address lpToken = info.lpToken;
        address baseToken = info.baseToken;
        address wbnb = router.WETH();
        uint lpBal = IERC20(lpToken).balanceOf(address(this));
        require(lpBal > 0, "NO_LP");

        IERC20(lpToken).approve(address(router), lpBal);

        if (baseToken == wbnb) {
            router.removeLiquidityETHSupportingFeeOnTransferTokens(
                _token,
                lpBal,
                0,
                0,
                address(this),
                block.timestamp + 300
            );
        } else {
            // USDT пара - определяем правильный порядок токенов (tokenA < tokenB)
            address tokenA;
            address tokenB;
            if (_token < baseToken) {
                tokenA = _token;
                tokenB = baseToken;
            } else {
                tokenA = baseToken;
                tokenB = _token;
            }

            router.removeLiquiditySupportingFeeOnTransferTokens(
                tokenA,
                tokenB,
                lpBal,
                0,
                0,
                address(this),
                block.timestamp + 300
            );
        }

        uint tokenBal = IERC20(_token).balanceOf(address(this));
        uint nativeBal = address(this).balance;

        if (tokenBal > 0) {
            IERC20(_token).safeTransfer(owner(), tokenBal);
        }

        if (baseToken != wbnb) {
            uint baseBal = IERC20(baseToken).balanceOf(address(this));
            if (baseBal > 0) {
                IERC20(baseToken).safeTransfer(owner(), baseBal);
            }
        }

        if (nativeBal > 0) {
            (bool success, ) = payable(owner()).call{value: nativeBal}("");
            require(success, "BNB_TRANSFER_FAILED");
        }

        emit LiquidityWithdrawn(_token, lpBal, tokenBal, nativeBal);
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
