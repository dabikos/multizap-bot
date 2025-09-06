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

contract Zap is Ownable {
    using SafeERC20 for IERC20;

    address public token;
    address public lpToken;
    IUniswapV2Router public router;

    constructor(
        address _token,
        address _lpToken,
        address _router
    ) Ownable(msg.sender) {
        require(_router != address(0), "INVALID_ROUTER");
        require(_token != address(0), "INVALID_TOKEN");
        require(_lpToken != address(0), "INVALID_LP_TOKEN");

        token = _token;
        lpToken = _lpToken;
        router = IUniswapV2Router(_router);
    }

    function zapIn(
        uint amountOutMinToken,
        uint amountTokenMin,
        uint amountETHMin
    ) external payable onlyOwner {
        require(msg.value > 0, "NO_ETH");
        uint half = msg.value / 2;
        uint otherHalf = msg.value - half;

        address[] memory path = new address[](2);
        path[0] = router.WETH();
        path[1] = token;

        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: half}(
            amountOutMinToken,
            path,
            address(this),
            block.timestamp + 300
        );

        uint tokenBal = IERC20(token).balanceOf(address(this));
        IERC20(token).forceApprove(address(router), tokenBal);

        router.addLiquidityETH{value: otherHalf}(
            token,
            tokenBal,
            amountTokenMin,
            amountETHMin,
            address(this),
            block.timestamp + 300
        );
    }

    function exitAndSell(
        uint amountTokenMin,
        uint amountETHMin,
        uint amountOutMinETH
    ) external onlyOwner {
        uint lpBal = IERC20(lpToken).balanceOf(address(this));
        require(lpBal > 0, "NO_LP");

        IERC20(lpToken).forceApprove(address(router), lpBal);

        router.removeLiquidityETHSupportingFeeOnTransferTokens(
            token,
            lpBal,
            amountTokenMin,
            amountETHMin,
            address(this),
            block.timestamp + 300
        );

        uint tokenBal = IERC20(token).balanceOf(address(this));
        if (tokenBal > 0) {
            address[] memory path = new address[](2);
            path[0] = token;
            path[1] = router.WETH();

            IERC20(token).forceApprove(address(router), tokenBal);

            router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                tokenBal,
                amountOutMinETH,
                path,
                address(this),
                block.timestamp + 300
            );
        }

        payable(owner()).transfer(address(this).balance);
    }

    receive() external payable {}
}



