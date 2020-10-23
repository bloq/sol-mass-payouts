// SPDX-License-Identifier: MIT

pragma solidity ^0.6.6;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./interfaces/IMultiTransfer.sol";

contract MultiTransfer is IMultiTransfer {
    using SafeERC20 for IERC20;

    /// @notice Transfer the tokens from sender to all the address provided in the array.
    /// @dev Left 160 bits are the recipient address and the right 96 bits are the token amount.
    /// @param bits array of uint
    /// @return true/false
    function multiTransfer(
        address erc20,
        uint256 amountIn,
        uint256[] calldata bits
    ) external override returns (bool) {
        require(erc20 != address(0));
        require(amountIn != 0);

        // receive total amount
        IERC20 token = IERC20(erc20);
        token.safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 totalOut = 0;

        // output amount to recipients
        for (uint256 i = 0; i < bits.length; i++) {
            address a = address(bits[i] >> 96);
            uint256 amount = bits[i] & ((1 << 96) - 1);
            token.safeTransferFrom(address(this), a, amount);

            totalOut += amount;
        }

        require(amountIn == totalOut);

        return true;
    }
}
