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

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB);

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

interface IWETH {
    function deposit() external payable;
    function transfer(address to, uint value) external returns (bool);
    function withdraw(uint) external;
    function balanceOf(address) external view returns (uint);
}

interface IUniswapV2Pair {
    function mint(address to) external returns (uint liquidity);
    function token0() external view returns (address);
    function token1() external view returns (address);
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
    address public wethAddress;  // Адрес WETH/WBNB (задается при деплое, т.к. роутеры используют разные имена функций)
    mapping(address => TokenInfo) public supportedTokens;
    address[] public tokenList;
    
    event TokenAdded(address indexed token, address indexed lpToken, address indexed baseToken);
    event TokenRemoved(address indexed token);
    event TokenStatusChanged(address indexed token, bool isActive);
    event LiquidityWithdrawn(address indexed token, uint256 lpAmount, uint256 tokenAmount, uint256 nativeAmount);
    event USDTAddressSet(address indexed usdtAddress);

    constructor(address _router, address _factory, address _usdtAddress, address _wethAddress) Ownable(msg.sender) {
        require(_router != address(0), "INVALID_ROUTER");
        require(_factory != address(0), "INVALID_FACTORY");
        require(_wethAddress != address(0), "INVALID_WETH");
        router = IUniswapV2Router(_router);
        factory = IUniswapV2Factory(_factory);
        usdtAddress = _usdtAddress;
        wethAddress = _wethAddress;
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
        address wbnb = wethAddress;
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

        address baseToken = _useUSDT ? usdtAddress : wethAddress;
        require(baseToken != address(0), "BASE_TOKEN_NOT_SET");
        
        // В PancakeSwap порядок токенов важен: getPair работает только если tokenA < tokenB
        // Проверяем оба варианта порядка
        address lpToken;
        if (_token < baseToken) {
            lpToken = factory.getPair(_token, baseToken);
        } else {
            lpToken = factory.getPair(baseToken, _token);
        }
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
        address wbnb = wethAddress;

        if (baseToken == wbnb) {
            // WBNB/WETH пара
            // Отправляем 1 wei в токен-контракт чтобы предотвратить .transfer(0)
            // на EIP-7702 адресах feeReceiver (sell-hook токена вызывает sendETHToFee(balance))
            uint prefund = 1;
            (bool prefundSent,) = _token.call{value: prefund}("");
            uint remaining = prefundSent ? msg.value - prefund : msg.value;
            uint half = remaining / 2;
            uint otherHalf = remaining - half;

            address[] memory path = new address[](2);
            path[0] = wbnb;
            path[1] = _token;

            // Запоминаем баланс ДО свопа
            uint tokenBalBefore = IERC20(_token).balanceOf(address(this));

            // Свопаем половину ETH на токены
            router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: half}(
                amountOutMinToken,
                path,
                address(this),
                block.timestamp + 300
            );

            // Дельта — только свежеполученные токены
            uint tokenBal = IERC20(_token).balanceOf(address(this)) - tokenBalBefore;
            require(tokenBal > 0, "NO_TOKENS_RECEIVED");

            // Даем максимальный approve роутеру (обход проблем с allowance)
            IERC20(_token).forceApprove(address(router), type(uint256).max);

            // Добавляем ликвидность через Router
            router.addLiquidityETH{value: otherHalf}(
                _token,
                tokenBal,
                0,  // amountTokenMin = 0 для гибкости (sell-hook может изменить баланс)
                0,  // amountETHMin = 0 для гибкости
                address(this),
                block.timestamp + 300
            );
        } else {
            // USDT пара - новая логика
            require(baseToken == usdtAddress, "INVALID_BASE_TOKEN");
            
            // Запоминаем балансы ДО свопа
            uint usdtBalBefore = IERC20(usdtAddress).balanceOf(address(this));

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

            // Вычисляем ТОЛЬКО полученные от свопа USDT (дельта)
            uint usdtBal = IERC20(usdtAddress).balanceOf(address(this)) - usdtBalBefore;
            require(usdtBal > 0, "NO_USDT_RECEIVED");

            uint halfUSDT = usdtBal / 2;
            uint otherHalfUSDT = usdtBal - halfUSDT;

            // Запоминаем баланс токена ДО свопа
            uint tokenBalBefore = IERC20(_token).balanceOf(address(this));

            // Свопаем половину USDT на токен
            address[] memory pathUSDTtoToken = new address[](2);
            pathUSDTtoToken[0] = usdtAddress;
            pathUSDTtoToken[1] = _token;

            IERC20(usdtAddress).forceApprove(address(router), halfUSDT);
            router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                halfUSDT,
                amountOutMinToken,
                pathUSDTtoToken,
                address(this),
                block.timestamp + 300
            );

            // Вычисляем ТОЛЬКО полученные от свопа токены (дельта)
            uint tokenBal = IERC20(_token).balanceOf(address(this)) - tokenBalBefore;
            require(tokenBal > 0, "NO_TOKENS_RECEIVED");

            // Добавляем ликвидность Token/USDT
            IERC20(_token).forceApprove(address(router), tokenBal);
            IERC20(usdtAddress).forceApprove(address(router), otherHalfUSDT);

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
        address baseToken = tokenInfo.baseToken;
        address wbnb = wethAddress;
        
        // Проверяем, что baseToken установлен
        require(baseToken != address(0), "BASE_TOKEN_NOT_SET");
        
        // Определяем правильный LP токен из Factory используя сохраненный baseToken
        // Это важно, так как токен может иметь обе пары (USDT и WBNB)
        // Мы должны использовать ту пару, которая была указана при добавлении токена
        address expectedLpToken;
        if (_token < baseToken) {
            expectedLpToken = factory.getPair(_token, baseToken);
        } else {
            expectedLpToken = factory.getPair(baseToken, _token);
        }
        require(expectedLpToken != address(0), "LP_PAIR_NOT_FOUND");
        
        // Используем правильный LP токен из Factory (с правильным baseToken)
        address lpToken = expectedLpToken;
        
        // Дополнительная проверка: убеждаемся, что LP токен соответствует сохраненному baseToken
        // Если сохраненный LP токен существует и имеет баланс, но не совпадает с ожидаемым,
        // это может означать, что токен был добавлен с неправильным baseToken
        address storedLpToken = tokenInfo.lpToken;
        if (storedLpToken != address(0) && storedLpToken != expectedLpToken) {
            // Проверяем баланс сохраненного LP токена
            uint storedLpBal = IERC20(storedLpToken).balanceOf(address(this));
            if (storedLpBal > 0) {
                // Если в сохраненном LP токене есть баланс, используем его
                // Это может быть случай, когда токен был добавлен вручную с правильным LP адресом
                lpToken = storedLpToken;
            }
        }
        
        uint lpBal = IERC20(lpToken).balanceOf(address(this));
        require(lpBal > 0, "NO_LP");

        // Даем разрешение роутеру на использование LP токенов
        // Сначала сбрасываем approve (на случай если был предыдущий)
        // Затем устанавливаем новый approve
        // Используем forceApprove из SafeERC20 для совместимости со всеми токенами
        IERC20(lpToken).forceApprove(address(router), lpBal);

        if (baseToken == wbnb) {
            // WBNB пара - существующая логика
            // Запоминаем баланс токена ДО удаления ликвидности
            uint tokenBalBefore = IERC20(_token).balanceOf(address(this));

            // Удаляем ликвидность
            router.removeLiquidityETHSupportingFeeOnTransferTokens(
                _token,
                lpBal,
                amountTokenMin,
                amountBNBMin,
                address(this),
                block.timestamp + 300
            );

            // Вычисляем ТОЛЬКО полученные от удаления ликвидности токены (дельта)
            uint tokenBal = IERC20(_token).balanceOf(address(this)) - tokenBalBefore;
            if (tokenBal > 0) {
                address[] memory path = new address[](2);
                path[0] = _token;
                path[1] = wbnb;

                // Даем разрешение роутеру на использование токенов
                IERC20(_token).forceApprove(address(router), tokenBal);

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
            uint amountAMin;
            uint amountBMin;
            if (_token < usdtAddress) {
                tokenA = _token;
                tokenB = usdtAddress;
                amountAMin = amountTokenMin;  // Для токена
                amountBMin = 0;               // Для USDT (0 для гибкости)
            } else {
                tokenA = usdtAddress;
                tokenB = _token;
                amountAMin = 0;               // Для USDT (0 для гибкости)
                amountBMin = amountTokenMin;  // Для токена
            }

            // Запоминаем балансы ДО удаления ликвидности
            uint tokenBalBefore = IERC20(_token).balanceOf(address(this));
            uint usdtBalBefore = IERC20(usdtAddress).balanceOf(address(this));

            // Удаляем ликвидность с правильным порядком токенов
            // Для USDT пар используем обычный removeLiquidity
            router.removeLiquidity(
                tokenA,
                tokenB,
                lpBal,
                amountAMin,
                amountBMin,
                address(this),
                block.timestamp + 300
            );

            // Вычисляем ТОЛЬКО полученные от удаления ликвидности (дельта)
            uint tokenBal = IERC20(_token).balanceOf(address(this)) - tokenBalBefore;
            uint usdtBal = IERC20(usdtAddress).balanceOf(address(this)) - usdtBalBefore;

            // Если оба баланса равны 0, значит removeLiquidity не сработал
            if (tokenBal == 0 && usdtBal == 0) {
                revert("NO_LIQUIDITY_RECEIVED_AFTER_REMOVE");
            }

            // Свопаем токены на USDT (если есть токены)
            if (tokenBal > 0) {
                address[] memory pathTokenToUSDT = new address[](2);
                pathTokenToUSDT[0] = _token;
                pathTokenToUSDT[1] = usdtAddress;

                IERC20(_token).forceApprove(address(router), tokenBal);
                router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    tokenBal,
                    0,
                    pathTokenToUSDT,
                    address(this),
                    block.timestamp + 300
                );
                
                // Обновляем баланс USDT после свопа (дельта от первоначального)
                usdtBal = IERC20(usdtAddress).balanceOf(address(this)) - usdtBalBefore;
            }

            // Свопаем весь USDT на BNB
            require(usdtBal > 0, "NO_USDT_TO_SWAP");
            address[] memory pathUSDTtoBNB = new address[](2);
            pathUSDTtoBNB[0] = usdtAddress;
            pathUSDTtoBNB[1] = wbnb;

            IERC20(usdtAddress).forceApprove(address(router), usdtBal);
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
     * @dev Выполняет частичную продажу LP токенов (5%, 25%, 50%, 75%)
     * @param _token Адрес токена
     * @param percent Процент продажи (5, 25, 50, 75)
     * @param amountTokenMin Минимальное количество токенов при удалении ликвидности
     * @param amountBNBMin Минимальное количество BNB при удалении ликвидности
     * @param amountOutMinBNB Минимальное количество BNB при свопе токенов
     */
    function exitAndSellPartial(
        address _token,
        uint percent,
        uint amountTokenMin,
        uint amountBNBMin,
        uint amountOutMinBNB
    ) external onlyOwner {
        require(supportedTokens[_token].token != address(0), "TOKEN_NOT_SUPPORTED");
        require(percent == 5 || percent == 25 || percent == 50 || percent == 75, "INVALID_PERCENT");
        
        TokenInfo memory tokenInfo = supportedTokens[_token];
        address baseToken = tokenInfo.baseToken;
        address wbnb = wethAddress;
        
        // Проверяем, что baseToken установлен
        require(baseToken != address(0), "BASE_TOKEN_NOT_SET");
        
        // Определяем правильный LP токен из Factory (используя baseToken из tokenInfo)
        address expectedLpToken;
        if (_token < baseToken) {
            expectedLpToken = factory.getPair(_token, baseToken);
        } else {
            expectedLpToken = factory.getPair(baseToken, _token);
        }
        require(expectedLpToken != address(0), "LP_PAIR_NOT_FOUND_FOR_BASE_TOKEN");
        
        address lpToken = expectedLpToken; // По умолчанию используем LP из Factory
        
        // Дополнительная проверка: если сохраненный LP токен имеет баланс, используем его
        address storedLpToken = tokenInfo.lpToken;
        if (storedLpToken != address(0) && storedLpToken != expectedLpToken) {
            uint storedLpBal = IERC20(storedLpToken).balanceOf(address(this));
            if (storedLpBal > 0) {
                lpToken = storedLpToken;
            }
        }

        uint lpBal = IERC20(lpToken).balanceOf(address(this));
        require(lpBal > 0, "NO_LP");
        
        // Вычисляем количество LP токенов для продажи
        uint lpToSell = (lpBal * percent) / 100;
        require(lpToSell > 0, "INSUFFICIENT_LP_TO_SELL");

        // Используем forceApprove из SafeERC20 для совместимости со всеми токенами
        IERC20(lpToken).forceApprove(address(router), lpToSell);

        if (baseToken == wbnb) {
            // WBNB пара
            // Запоминаем баланс токена ДО удаления ликвидности
            uint tokenBalBefore = IERC20(_token).balanceOf(address(this));

            router.removeLiquidityETHSupportingFeeOnTransferTokens(
                _token,
                lpToSell,
                amountTokenMin,
                amountBNBMin,
                address(this),
                block.timestamp + 300
            );

            // Вычисляем ТОЛЬКО полученные от удаления ликвидности токены (дельта)
            uint tokenBal = IERC20(_token).balanceOf(address(this)) - tokenBalBefore;
            if (tokenBal > 0) {
                address[] memory path = new address[](2);
                path[0] = _token;
                path[1] = wbnb;

                // Даем разрешение роутеру на использование токенов
                IERC20(_token).forceApprove(address(router), tokenBal);

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

            address tokenA;
            address tokenB;
            uint amountAMin;
            uint amountBMin;
            if (_token < usdtAddress) {
                tokenA = _token;
                tokenB = usdtAddress;
                amountAMin = amountTokenMin;
                amountBMin = 0;
            } else {
                tokenA = usdtAddress;
                tokenB = _token;
                amountAMin = 0;
                amountBMin = amountTokenMin;
            }

            // Запоминаем балансы ДО удаления ликвидности
            uint tokenBalBefore = IERC20(_token).balanceOf(address(this));
            uint usdtBalBefore = IERC20(usdtAddress).balanceOf(address(this));

            // Удаляем ликвидность с правильным порядком токенов
            router.removeLiquidity(
                tokenA,
                tokenB,
                lpToSell,
                amountAMin,
                amountBMin,
                address(this),
                block.timestamp + 300
            );

            // Вычисляем ТОЛЬКО полученные от удаления ликвидности (дельта)
            uint tokenBal = IERC20(_token).balanceOf(address(this)) - tokenBalBefore;
            uint usdtBal = IERC20(usdtAddress).balanceOf(address(this)) - usdtBalBefore;

            // Свопаем токены на USDT, если есть
            if (tokenBal > 0) {
                address[] memory path = new address[](2);
                path[0] = _token;
                path[1] = usdtAddress;

                IERC20(_token).forceApprove(address(router), tokenBal);
                router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    tokenBal,
                    amountOutMinBNB, // Используем как минимальное количество USDT
                    path,
                    address(this),
                    block.timestamp + 300
                );
                // Обновляем баланс USDT после свопа (дельта от первоначального)
                usdtBal = IERC20(usdtAddress).balanceOf(address(this)) - usdtBalBefore;
            }

            // Свопаем USDT на BNB
            require(usdtBal > 0, "NO_USDT_TO_SWAP");
            address[] memory pathUSDTtoBNB = new address[](2);
            pathUSDTtoBNB[0] = usdtAddress;
            pathUSDTtoBNB[1] = wbnb;

            IERC20(usdtAddress).forceApprove(address(router), usdtBal);
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
        address wbnb = wethAddress;
        uint lpBal = IERC20(lpToken).balanceOf(address(this));
        require(lpBal > 0, "NO_LP");

        IERC20(lpToken).forceApprove(address(router), lpBal);

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


    /**
     * @dev Извлекает застрявшие токены из контракта (остатки от неполных операций)
     * @param _token Адрес токена для извлечения
     */
    function rescueTokens(address _token) external onlyOwner {
        uint balance = IERC20(_token).balanceOf(address(this));
        require(balance > 0, "NO_TOKEN_BALANCE");
        IERC20(_token).safeTransfer(owner(), balance);
    }

    /**
     * @dev Извлекает застрявший ETH/BNB из контракта
     */
    function rescueETH() external onlyOwner {
        uint balance = address(this).balance;
        require(balance > 0, "NO_ETH_BALANCE");
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "ETH_TRANSFER_FAILED");
    }

    receive() external payable {}
}
