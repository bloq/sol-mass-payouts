// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IMerkleBox {
    event NewMerkle(
        address indexed sender,
        address indexed erc20,
        uint256 amount,
        bytes32 indexed merkleRoot,
        uint256 claimGroupId,
        uint256 withdrawUnlockTime
    );
    event MerkleClaim(address indexed account, address indexed erc20, uint256 amount);
    event MerkleFundUpdate(address indexed funder, bytes32 indexed merkleRoot, uint256 claimGroupId, uint256 amount, bool withdraw);

    function addFunds(uint256 claimGroupId, uint256 amount) external;
    function addFundsWithPermit(uint256 claimGroupId, address funder, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;

    function withdrawFunds(uint256 claimGroupId, uint256 amount) external;

    function newClaimsGroup(
        address erc20,
        uint256 amount,
        bytes32 merkleRoot,
        uint256 withdrawUnlockTime
    ) external returns (uint256);

    function isClaimable(
        uint256 claimGroupId,
        address account,
        uint256 amount,
        bytes32[] memory proof
    ) external view returns (bool);

    function claim(
        uint256 claimGroupId,
        address account,
        uint256 amount,
        bytes32[] memory proof
    ) external;
}
