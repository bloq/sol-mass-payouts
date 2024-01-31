// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

interface IMultiTransfer {
    function multiTransfer(address erc20, uint256[] calldata bits) external returns (bool);
}
