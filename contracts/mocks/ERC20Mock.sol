// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// mock class using ERC20
contract ERC20Mock is ERC20 {
    constructor(address mintTo_, uint256 totalSupply_) payable ERC20("Test Token", "TEST") {
        _mint(mintTo_, totalSupply_);
    }
}
