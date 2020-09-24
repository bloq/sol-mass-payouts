
// SPDX-License-Identifier: MIT

pragma solidity ^0.6.6;

import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts/cryptography/MerkleProof.sol';
import './interfaces/IMerkleBox.sol';

contract MerkleBox is IMerkleBox {
    using MerkleProof for MerkleProof;
    using SafeERC20 for IERC20;

    struct Holding {
	address owner;		// account that contributed funds
	address erc20;
	uint256 balance;	
	bytes32 merkleRoot;
	bool withdrawable;
    }

    mapping(bytes32 => Holding) public holdings;
    mapping(bytes32 => mapping(bytes32 => bool)) public leafClaimed;

    function addFunds(bytes32 merkleRoot, uint256 amount) external override {
	// prelim. parameter checks
	require(amount != 0, "Invalid amount");

	// reference our struct storage
        Holding storage holding = holdings[merkleRoot];
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
	holding.balance += amount;

	emit MerkleFundUpdate(msg.sender, merkleRoot, amount, false);
    }

    function withdrawFunds(bytes32 merkleRoot, uint256 amount) external override {
	// reference our struct storage
        Holding storage holding = holdings[merkleRoot];
	require(holding.owner != address(0), "Holding does not exist");
	require(holding.withdrawable == true, "Holdings may not be withdrawn");
	require(holding.owner == msg.sender, "Only owner may withdraw");

	// calculate amount to withdraw.  handle withdraw-all.
	IERC20 token = IERC20(holding.erc20);
	if (amount == uint256(-1)) {
	    amount = holding.balance;
	}
	require(amount <= holding.balance, "Insufficient balance");

	// transfer token to this contract
	token.safeTransferFrom(address(this), msg.sender, amount);

	// update holdings record
	holding.balance -= amount;

	emit MerkleFundUpdate(msg.sender, merkleRoot, amount, true);
    }

    function addClaims(address erc20, uint256 amount, bytes32 merkleRoot,
    		       bool withdrawable) external override {
	// prelim. parameter checks
	require(erc20 != address(0), "Invalid ERC20 address");
	require(merkleRoot != 0, "Merkle cannot be zero");

	// reference our struct storage
        Holding storage holding = holdings[merkleRoot];
	require(holding.owner == address(0), "Holding already exists");

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
	holding.balance = balance;
	holding.merkleRoot = merkleRoot;
	holding.withdrawable = withdrawable;

	emit NewMerkle(msg.sender, erc20, amount, merkleRoot, withdrawable);
    }

    function claimable(bytes32 merkleRoot, uint256 amount, bytes32[] memory proof) external override view returns (bool) {

	bytes32 leaf = _leafHash(amount);
	if (leafClaimed[merkleRoot][leaf] == true) {
	    return false;
	}
	return MerkleProof.verify(proof, merkleRoot, leaf);
    }

    function claim(bytes32 merkleRoot, uint256 amount, bytes32[] memory proof) external override {
	bytes32 leaf = _leafHash(amount);

	// already spent?
	require(leafClaimed[merkleRoot][leaf] == false, "Already claimed");

	// merkle proof valid?
        require(MerkleProof.verify(proof, merkleRoot, leaf) == true, "Claim not found");

	// holding exists?
        Holding storage holding = holdings[merkleRoot];
	require(holding.owner != address(0), "Holding not found");

	// sufficient balance exists?   (funder may have under-funded)
	require(holding.balance >= amount, "Claim under-funded by funder.");

	// assertion, for condition that should never happen in the field
	IERC20 token = IERC20(holding.erc20);
	uint256 totalBalance = token.balanceOf(msg.sender);
	require(holding.balance >= totalBalance, "BUG: Internal balance error");

	// update state
	leafClaimed[merkleRoot][leaf] = true;
	holding.balance -= amount;
	token.safeTransferFrom(address(this), msg.sender, amount);

	emit MerkleClaim(msg.sender, holding.erc20, amount);
    }

    //////////////////////////////////////////////////////////

    function _leafHash(uint256 amount) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(msg.sender, amount));
    }

}

