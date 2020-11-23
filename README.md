# sol-mass-payouts

Utilities enabling the mass distribution of assets, with a single
funding transaction.

## Summary example

A funder, such as a yield farming distribution, wishes to distribute
1,000,000 XYZ tokens to 50,000 addresses.

Off-chain, the funder builds a merkle tree of (address,amount) pairs for XYZ
payouts.

The funder sends 1,000,000 XYZ tokens, and the Merkle root hash, to this
MerkleBox contract for secure storage.

Then, at any time, users may claim their XYZ tokens by providing a
Merkle proof of their (address,amount).

The end result is aggregating all the payouts into a single blockchain
transaction _from the funder_.  (Users must still individually issue
claim transactions)

## Public operations (APIs)

### Anyone:  Validate claim

Validate a supplied merkle receipt is associated with a valid, unspent claim.

### Anyone:   Claim tokens

Present a valid merkle receipt with account associated with it and transfer the associated tokens to given account.

Provided account address must be the address in the claim, and the claim must be unspent.

### Funder:  Create new claims group

Store a merkle root, and associated ERC20 funds, on chain.
Must provide withdraw unlock time and its value must be atleast 30 days higher than claim group create time. 

**WARNING**:  There is no on-chain validation that funds supplied equal the
funds required to fully satisfy all claims.  The funder may under-fund.
> Funder can not claim tokens via `claim()`

### Anyone:  Add more funds to claims group.

Supply additional quantity of asset to the claims group.

Usually the funder calls this operation, but that is not a requirement.
Once a claims group is created, anyone may supply additional funds.

### Funder:  Withdraw funds from claims group.

The funder (owner) may withdraw funds from the claims group,
if-and-only-if the Withdraw Unlock time is reached.

### Anyone:  On-chain ERC20 mass-send

A separate MultiTransfer contract is provided, which provides the
simple utility of

1. Receive N amount of an ERC20 token
2. Send tokens to a list of (address,amount) pairs.

This contract and function is not tied in any way to the above
merkle-related operations, and is provided as an alternate mass-pay
operation for ERC20 tokens.

## Security notes

### Under-funding

It appears prohibitively expensive to validate that a holding is fully
funded.  (Solutions welcome)

As a consequence, it is possible to under-fund a claims group.

### Withdraw locking

The withdraw lock feature permits disabling of withdrawals until
a specified time.

There will be atleast 30 days withdraw locking. To permanently lock the funds, set the lock time to a
maximum, or an arbitrary time millions of years in the future.

## Setup.
1. Install packages
   ```
   npm i -g truffle
   npm i
   ```
2. Update provider url in config/default.json
3. Set DEPLOYMENT_ACCOUNT_KEY in env
   ```
   create a .env file in root
   DEPLOYMENT_ACCOUNT_KEY =  "my mnemonic phrase"
   ```
4. Deploy you own contracts if want to do arb- 
   ``` 
   truffle migrate --reset --network mainnet/ropsten
   ```
