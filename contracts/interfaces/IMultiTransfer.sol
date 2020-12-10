// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IMultiTransfer {
    function multiTransfer(
        address erc20,
        uint256[] calldata bits
    ) external returns (bool);
}
