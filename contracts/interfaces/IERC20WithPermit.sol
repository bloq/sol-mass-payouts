// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC20WithPermit is IERC20 {
    function permit(address, address, uint256, uint256, uint8, bytes32, bytes32) external;
}
