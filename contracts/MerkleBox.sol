// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/cryptography/MerkleProof.sol";
import "./interfaces/IMerkleBox.sol";

contract MerkleBox is IMerkleBox {
    using MerkleProof for MerkleProof;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    struct Holding {
        address owner; // account that contributed funds
        address erc20; // claim-able ERC20 asset
        uint256 balance; // amount of token held currently
        bytes32 merkleRoot; // root of claims merkle tree
        uint256 withdrawUnlockTime; // withdraw forbidden before this time
    }

    mapping(uint256 => Holding) public holdings;
    mapping(address => uint256[]) public claimGroupIds;
    mapping(bytes32 => mapping(bytes32 => bool)) public leafClaimed;
    uint256 public constant LOCKING_PERIOD = 30 days;
    uint256 public claimGroupCount;

    function addFunds(uint256 claimGroupId, uint256 amount) external override {
        // prelim. parameter checks
        require(amount != 0, "Invalid amount");

        // reference our struct storage
        Holding storage holding = holdings[claimGroupId];
        require(holding.owner != address(0), "Holding does not exist");

        // calculate amount to deposit.  handle deposit-all.
        IERC20 token = IERC20(holding.erc20);
        uint256 balance = token.balanceOf(msg.sender);
        if (amount == uint256(-1)) {
            amount = balance;
        }
        require(amount <= balance, "Insufficient balance");
        require(amount != 0, "Amount cannot be zero");

        // transfer token to this contract
        token.safeTransferFrom(msg.sender, address(this), amount);

        // update holdings record
        holding.balance = holding.balance.add(amount);

        emit MerkleFundUpdate(msg.sender, holding.merkleRoot, claimGroupId, amount, false);
    }

    function withdrawFunds(uint256 claimGroupId, uint256 amount) external override {
        // reference our struct storage
        Holding storage holding = holdings[claimGroupId];
        require(holding.owner != address(0), "Holding does not exist");
        require(block.timestamp >= holding.withdrawUnlockTime, "Holdings may not be withdrawn");
        require(holding.owner == msg.sender, "Only owner may withdraw");

        // calculate amount to withdraw.  handle withdraw-all.
        IERC20 token = IERC20(holding.erc20);
        if (amount == uint256(-1)) {
            amount = holding.balance;
        }
        require(amount <= holding.balance, "Insufficient balance");

        // update holdings record
        holding.balance = holding.balance.sub(amount);

        // transfer token to this contract
        token.safeTransfer(msg.sender, amount);

        emit MerkleFundUpdate(msg.sender, holding.merkleRoot, claimGroupId, amount, true);
    }

    function newClaimsGroup(
        address erc20,
        uint256 amount,
        bytes32 merkleRoot,
        uint256 withdrawUnlockTime
    ) external override {
        // prelim. parameter checks
        require(erc20 != address(0), "Invalid ERC20 address");
        require(merkleRoot != 0, "Merkle cannot be zero");
        require(withdrawUnlockTime >= block.timestamp + LOCKING_PERIOD, "Holing lock must exceed minimum lock period");

        claimGroupCount++;
        // reference our struct storage
        Holding storage holding = holdings[claimGroupCount];

        // calculate amount to deposit.  handle deposit-all.
        IERC20 token = IERC20(erc20);
        uint256 balance = token.balanceOf(msg.sender);
        if (amount == uint256(-1)) {
            amount = balance;
        }
        require(amount <= balance, "Insufficient balance");
        require(amount != 0, "Amount cannot be zero");

        // transfer token to this contract
        token.safeTransferFrom(msg.sender, address(this), amount);

        // record holding in stable storage
        holding.owner = msg.sender;
        holding.erc20 = erc20;
        holding.balance = amount;
        holding.merkleRoot = merkleRoot;
        holding.withdrawUnlockTime = withdrawUnlockTime;
        claimGroupIds[msg.sender].push(claimGroupCount);
        emit NewMerkle(msg.sender, erc20, amount, merkleRoot, claimGroupCount, withdrawUnlockTime);
    }

    function isClaimable(
        uint256 claimGroupId,
        address account,
        uint256 amount,
        bytes32[] memory proof
    ) external view override returns (bool) {
        // holding exists?
        Holding memory holding = holdings[claimGroupId];
        if (holding.owner == address(0)) {
            return false;
        }
        //  holding owner?
        if (holding.owner == account) {
            return false;
        }
        // sufficient balance exists?   (funder may have under-funded)
        if (holding.balance < amount) {
            return false;
        }

        bytes32 leaf = _leafHash(account, amount);
        // already claimed?
        if (leafClaimed[holding.merkleRoot][leaf]) {
            return false;
        }
        // merkle proof is invalid or claim not found
        if (!MerkleProof.verify(proof, holding.merkleRoot, leaf)) {
            return false;
        }
        return true;
    }

    function claim(
        uint256 claimGroupId,
        address account,
        uint256 amount,
        bytes32[] memory proof
    ) external override {
        // holding exists?
        Holding storage holding = holdings[claimGroupId];
        require(holding.owner != address(0), "Holding not found");

        //  holding owner?
        require(holding.owner != account, "Holding owner cannot claim");

        // sufficient balance exists?   (funder may have under-funded)
        require(holding.balance >= amount, "Claim under-funded by funder.");

        bytes32 leaf = _leafHash(account, amount);

        // already spent?
        require(leafClaimed[holding.merkleRoot][leaf] == false, "Already claimed");

        // merkle proof valid?
        require(MerkleProof.verify(proof, holding.merkleRoot, leaf) == true, "Claim not found");

        // update state
        leafClaimed[holding.merkleRoot][leaf] = true;
        holding.balance = holding.balance.sub(amount);
        IERC20(holding.erc20).safeTransfer(account, amount);

        emit MerkleClaim(account, holding.erc20, amount);
    }

    function getClaimGroupIds(address owner) public view returns (uint256[] memory ids) {
        ids = claimGroupIds[owner];
    }

    //////////////////////////////////////////////////////////

    // generate hash of (claim holder, amount)
    // claim holder must be the caller
    function _leafHash(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(account, amount));
    }
}
