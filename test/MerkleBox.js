'use strict'

const MerkleBox = artifacts.require('MerkleBox')
const ERC20Mock = artifacts.require('mocks/ERC20WithPermitMock')
const expect = require('chai').expect
const {MerkleTree} = require('./helpers/merkleTree.js')
const {ecsign} = require('ethereumjs-util')
const {MaxUint256} = require('ethers/constants')
const {expectRevert, expectEvent, BN, constants, time} = require('@openzeppelin/test-helpers')

function receipt (recipient, amount) {
  return web3.utils.soliditySha3({t: 'address', v: recipient}, {t: 'uint256', v: amount})
}

contract('MerkleBox', async (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const [_, funder, funder2, recipient, recipient2, other] = accounts
  let erc20, merkleBox, unlockTime, funder3, funder3PrivateKey

  beforeEach(async () => {
    merkleBox = await MerkleBox.new()
    erc20 = await ERC20Mock.new()
    await erc20.mintInternal(funder, 1000)
    await erc20.mintInternal(funder2, 1000)
    funder3PrivateKey = '0xa11a58ba8887796d1a7bc2a6107a98e0befd2b10c8846a39f39c05c6a976e725'
    funder3 = '0xA73Ead6953c1464d6F7Ce14E718cc8d8EE531e05'
    await erc20.mintInternal(funder3, 1000)
    unlockTime = (await time.latest()).add(time.duration.weeks(5))
  })

  context('before a claims group is created', async () => {
    const merkleTree = new MerkleTree([receipt(recipient, 10), receipt(recipient2, 20)])

    it('reverts when attempting to add funds to unknown claims group', async () => {
      await erc20.approve(merkleBox.address, 50, {from: funder2})
      const claimGroupId = 42
      await expectRevert(merkleBox.addFunds(claimGroupId, 50, {from: funder2}), 'Holding does not exist')
    })

    it('isClaimable() returns false for an unknown claims group', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      const claimGroupId = 42
      expect(await merkleBox.isClaimable(claimGroupId, recipient, 10, proof, {from: recipient})).to.equal(false)
    })

    it('reverts when claiming from an unknown claims group', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      const claimGroupId = 42
      await expectRevert(merkleBox.claim(claimGroupId, recipient, 10, proof, {from: recipient}), 'Holding not found')
    })
  })

  context('when creating a new claims group', async () => {
    const merkleTree = new MerkleTree([receipt(recipient, 10), receipt(recipient2, 20)])
    const merkleRoot = merkleTree.getHexRoot()

    it('emits NewMerkle event and deposits funds', async () => {
      await erc20.approve(merkleBox.address, 1000, {from: funder})
      const tx = await merkleBox.newClaimsGroup(erc20.address, 1000, merkleRoot, unlockTime, {from: funder})
      expectEvent(tx, 'NewMerkle', {
        sender: funder,
        erc20: erc20.address,
        amount: new BN(1000),
        merkleRoot: merkleRoot,
        claimGroupId: new BN(1),
        withdrawUnlockTime: unlockTime
      })
      assert.equal(await erc20.balanceOf(funder), 0)
      assert.equal(await erc20.balanceOf(merkleBox.address), 1000)
    })

    it('reverts if ERC20 address is zero', async () => {
      await erc20.approve(merkleBox.address, 1000, {from: funder})
      await expectRevert(merkleBox.newClaimsGroup(constants.ZERO_ADDRESS, 1000, merkleRoot, unlockTime, {from: funder}), 'Invalid ERC20 address')
    })

    it('reverts if merkleRoot is zero', async () => {
      await erc20.approve(merkleBox.address, 1000, {from: funder})
      await expectRevert(merkleBox.newClaimsGroup(erc20.address, 1000, constants.ZERO_ADDRESS, unlockTime, {from: funder}), 'Merkle cannot be zero')
    })

    it('reverts if withdraw lock time is less than minimum', async () => {
      const errorMessage = 'Holing lock must exceed minimum lock period.'
      await erc20.approve(merkleBox.address, 1000, {from: funder})
      await expectRevert(merkleBox.newClaimsGroup(erc20.address, 1000, merkleRoot, 0, {from: funder}), errorMessage)
    })

    it('reverts if insufficient balance', async () => {
      await erc20.approve(merkleBox.address, 1000, {from: funder})
      await expectRevert(merkleBox.newClaimsGroup(erc20.address, 1001, merkleRoot, unlockTime, {from: funder}), 'Insufficient balance')
    })

    it('reverts if amount is zero', async () => {
      await erc20.approve(merkleBox.address, 1000, {from: funder})
      await expectRevert(merkleBox.newClaimsGroup(erc20.address, 0, merkleRoot, unlockTime, {from: funder}), 'Amount cannot be zero')
    })
  })

  context('after creating a claims group', async () => {
    const merkleTree = new MerkleTree([receipt(recipient, 10), receipt(recipient2, 20)])
    const merkleRoot = merkleTree.getHexRoot()
    var claimGroupId

    beforeEach(async () => {
      await erc20.approve(merkleBox.address, 1000, {from: funder})
      claimGroupId = await merkleBox.newClaimsGroup.call(erc20.address, 1000, merkleRoot, unlockTime, {from: funder})
      await merkleBox.newClaimsGroup(erc20.address, 1000, merkleRoot, unlockTime, {from: funder})
    })

    it('funder cannot withdraw', async () => {
      await expectRevert(merkleBox.withdrawFunds(claimGroupId, 50, {from: funder}), 'Holdings may not be withdrawn')
    })

    it('should get list of claim ids', async () => {
      await erc20.approve(merkleBox.address, 1000, {from: funder2})
      await merkleBox.newClaimsGroup(erc20.address, 500, merkleRoot, unlockTime, {from: funder2})
      await merkleBox.newClaimsGroup(erc20.address, 500, merkleRoot, unlockTime, {from: funder2})
      const ids = await merkleBox.getClaimGroupIds(funder2)
      assert.equal(ids.length, '2', 'claimGroupIds list is wrong')
    })

    it('funder cannot withdraw-all', async () => {
      await expectRevert(merkleBox.withdrawFunds(claimGroupId, -1, {from: funder}), 'Holdings may not be withdrawn')
    })

    it('anyone can add funds', async () => {
      await erc20.approve(merkleBox.address, 50, {from: funder2})
      const tx = await merkleBox.addFunds(claimGroupId, 50, {from: funder2})
      expectEvent(tx, 'MerkleFundUpdate', {funder: funder2, merkleRoot, claimGroupId, amount: new BN(50), withdraw: false})
      assert.equal(await erc20.balanceOf(funder2), 950)
      assert.equal(await erc20.balanceOf(merkleBox.address), 1050)
    })

    it('anyone can add funds with deposit-all (amount = -1)', async () => {
      await erc20.approve(merkleBox.address, 1000, {from: funder2})
      const tx = await merkleBox.addFunds(claimGroupId, -1, {from: funder2})
      expectEvent(tx, 'MerkleFundUpdate', {funder: funder2, merkleRoot, claimGroupId, amount: new BN(1000), withdraw: false})
      assert.equal(await erc20.balanceOf(funder2), 0)
      assert.equal(await erc20.balanceOf(merkleBox.address), 2000)
    })

    it('anyone can add funds with permit', async () => {
      const deadline = MaxUint256
      const digest = await erc20.getPermitDigest(funder3, merkleBox.address, 50, deadline)
      const {v, r, s} = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(funder3PrivateKey.slice(2), 'hex'))
      const tx = await merkleBox.addFundsWithPermit(claimGroupId, funder3, 50, deadline, v, r, s, {from: other})
      expectEvent(tx, 'MerkleFundUpdate', {funder: funder3, merkleRoot, claimGroupId, amount: new BN(50), withdraw: false})
      assert.equal(await erc20.balanceOf(funder3), 950)
      assert.equal(await erc20.balanceOf(merkleBox.address), 1050)
    })

    it('reverts when attempting to add funds with amount = 0', async () => {
      const deadline = MaxUint256
      const digest = await erc20.getPermitDigest(funder3, merkleBox.address, 0, deadline)
      const {v, r, s} = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(funder3PrivateKey.slice(2), 'hex'))
      await expectRevert(merkleBox.addFundsWithPermit(claimGroupId, funder3, 0, deadline, v, r, s, {from: other}), 'Invalid amount')
    })

    it('reverts when attempting to add funds with permit and amount = 0', async () => {
      await erc20.approve(merkleBox.address, 50, {from: funder2})
      await expectRevert(merkleBox.addFunds(claimGroupId, 0, {from: funder2}), 'Invalid amount')
    })

    it('recipient can claim', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      const tx = await merkleBox.claim(claimGroupId, recipient, 10, proof, {from: recipient})
      expectEvent(tx, 'MerkleClaim', {account: recipient, erc20: erc20.address, amount: new BN(10)})
      assert.equal(await erc20.balanceOf(recipient), 10)
      assert.equal(await erc20.balanceOf(merkleBox.address), 990)
    })

    it('revert if amount is wrong', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      await expectRevert(merkleBox.claim(claimGroupId, recipient, 11, proof, {from: recipient}), 'Claim not found')
    })

    it('other account can claim on behalf of recipient', async () => {
      const r = receipt(recipient2, 20)
      const proof = merkleTree.getHexProof(r)
      const tx = await merkleBox.claim(claimGroupId, recipient2, 20, proof, {from: other})
      expectEvent(tx, 'MerkleClaim', {account: recipient2, erc20: erc20.address, amount: new BN(20)})
      assert.equal(await erc20.balanceOf(recipient2), 20)
      assert.equal(await erc20.balanceOf(merkleBox.address), 980)
    })

    it('recipient cannot claim twice', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      await merkleBox.claim(claimGroupId, recipient, 10, proof, {from: recipient})
      await expectRevert(merkleBox.claim(claimGroupId, recipient, 10, proof, {from: recipient}), 'Already claimed')
    })

    it('isClaimable() returns true for a valid and unclaimed Merkle proof', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      expect(await merkleBox.isClaimable(claimGroupId, recipient, 10, proof, {from: recipient})).to.equal(true)
    })

    it('isClaimable() returns false for a valid but already claimed Merkle proof', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      await merkleBox.claim(claimGroupId, recipient, 10, proof, {from: recipient})
      expect(await merkleBox.isClaimable(claimGroupId, recipient, 10, proof, {from: recipient})).to.equal(false)
    })

    it('reverts when claiming with an invalid Merkle proof', async () => {
      const r = receipt(recipient, 42)
      const newTree = new MerkleTree([receipt(recipient, 42), receipt(recipient2, 23)])
      const proof = newTree.getHexProof(r)
      await expectRevert(merkleBox.claim(claimGroupId, recipient, 10, proof, {from: recipient}), 'Claim not found')
    })

    it('isClaimable() returns false for an invalid Merkle proof', async () => {
      const r = receipt(recipient, 42)
      const newTree = new MerkleTree([receipt(recipient, 42), receipt(recipient2, 23)])
      const proof = newTree.getHexProof(r)
      expect(await merkleBox.isClaimable(claimGroupId, recipient, 10, proof, {from: recipient})).to.equal(false)
    })

    it('reverts when claiming with a Merkle proof of invalid length', async () => {
      const r = receipt(recipient, 10)
      let proof = merkleTree.getHexProof(r)
      proof = proof.slice(0, proof.length - 5)
      await expectRevert(merkleBox.claim(claimGroupId, recipient, 10, proof, {from: recipient}), 'Claim not found')
    })

    it('isClaimable() returns false for a Merkle proof of invalid length', async () => {
      const r = receipt(recipient, 10)
      let proof = merkleTree.getHexProof(r)
      proof = proof.slice(0, proof.length - 5)
      expect(await merkleBox.isClaimable(claimGroupId, recipient, 10, proof, {from: recipient})).to.equal(false)
    })

    it('reverts when holding is not found for given Merkle root', async () => {
      const merkleTree2 = new MerkleTree([receipt(recipient, 10), receipt(recipient2, 25)])
      const r = receipt(recipient, 10)
      const proof = merkleTree2.getHexProof(r)
      await expectRevert(merkleBox.claim('111', recipient, 10, proof, {from: recipient}), 'Holding not found')
    })

    it('isClaimable() returns false when holding is not found for given Merkle root', async () => {
      const merkleTree2 = new MerkleTree([receipt(recipient, 10), receipt(recipient2, 25)])
      const r = receipt(recipient, 10)
      const proof = merkleTree2.getHexProof(r)
      expect(await merkleBox.isClaimable('1122', recipient, 10, proof, {from: recipient})).to.equal(false)
    })

    context('when unlock time is reached', async () => {
      beforeEach(async () => {
        await time.increaseTo(unlockTime)
      })

      it('funder can withdraw', async () => {
        const tx = await merkleBox.withdrawFunds(claimGroupId, 50, {from: funder})
        expectEvent(tx, 'MerkleFundUpdate', {funder: funder, merkleRoot: merkleRoot, amount: new BN(50), withdraw: true})
        assert.equal(await erc20.balanceOf(funder), 50)
        assert.equal(await erc20.balanceOf(merkleBox.address), 950)
      })

      it('funder can withdraw-all (amount = -1)', async () => {
        await merkleBox.withdrawFunds(claimGroupId, 50, {from: funder})
        const tx = await merkleBox.withdrawFunds(claimGroupId, -1, {from: funder})
        expectEvent(tx, 'MerkleFundUpdate', {funder: funder, merkleRoot, claimGroupId, amount: new BN(950), withdraw: true})
        assert.equal(await erc20.balanceOf(funder), 1000)
        assert.equal(await erc20.balanceOf(merkleBox.address), 0)
      })

      it('funder cannot over-withdraw', async () => {
        await expectRevert(merkleBox.withdrawFunds(claimGroupId, 1001, {from: funder}), 'Insufficient balance')
      })

      it('other cannot withdraw', async () => {
        await expectRevert(merkleBox.withdrawFunds(claimGroupId, 1000, {from: other}), 'Only owner may withdraw')
      })

      it('recipient can claim', async () => {
        const r = receipt(recipient, 10)
        const proof = merkleTree.getHexProof(r)
        const tx = await merkleBox.claim(claimGroupId, recipient, 10, proof, {from: recipient})
        expectEvent(tx, 'MerkleClaim', {account: recipient, erc20: erc20.address, amount: new BN(10)})
        assert.equal(await erc20.balanceOf(recipient), 10)
      })
    })

    it('can create a second claims group with the same Merkle root', async () => {
      await erc20.approve(merkleBox.address, 1000, {from: funder2})
      const tx = await merkleBox.newClaimsGroup(erc20.address, 1000, merkleRoot, unlockTime, {from: funder2})
      expectEvent(tx, 'NewMerkle', {
        sender: funder2,
        erc20: erc20.address,
        amount: new BN(1000),
        merkleRoot: merkleRoot,
        claimGroupId: new BN(2),
        withdrawUnlockTime: unlockTime
      })
      assert.equal(await erc20.balanceOf(funder2), 0)
      assert.equal(await erc20.balanceOf(merkleBox.address), 2000)
    })
  })

  context('when a claims group is underfunded', async () => {
    const merkleTree = new MerkleTree([receipt(recipient, 10), receipt(recipient2, 20)])
    const merkleRoot = merkleTree.getHexRoot()
    var claimGroupId

    beforeEach(async () => {
      await erc20.approve(merkleBox.address, 29, {from: funder})
      claimGroupId = await merkleBox.newClaimsGroup.call(erc20.address, 29, merkleRoot, unlockTime, {from: funder})
      await merkleBox.newClaimsGroup(erc20.address, 29, merkleRoot, unlockTime, {from: funder})
      const proof = merkleTree.getHexProof(receipt(recipient2, 20))
      await merkleBox.claim(claimGroupId, recipient2, 20, proof, {from: recipient2})
    })

    it('cannot claim when not enough balance', async () => {
      const proof = merkleTree.getHexProof(receipt(recipient, 10))
      await expectRevert(merkleBox.claim(claimGroupId, recipient, 10, proof, {from: recipient}), 'Claim under-funded by funder.')
    })

    it('can claim after funds are added', async () => {
      await erc20.approve(merkleBox.address, 1, {from: funder2})
      await merkleBox.addFunds(claimGroupId, 1, {from: funder2})
      const proof = merkleTree.getHexProof(receipt(recipient, 10))
      const tx = await merkleBox.claim(claimGroupId, recipient, 10, proof, {from: recipient})
      expectEvent(tx, 'MerkleClaim', {account: recipient, erc20: erc20.address, amount: new BN(10)})
      assert.equal(await erc20.balanceOf(recipient), 10)
    })
  })

  context('when a claims group has owner address in Merkle', async () => {
    const merkleTree = new MerkleTree([receipt(funder, 10), receipt(recipient2, 20)])
    const merkleRoot = merkleTree.getHexRoot()
    var claimGroupId

    beforeEach(async () => {
      await erc20.approve(merkleBox.address, 30, {from: funder})
      claimGroupId = await merkleBox.newClaimsGroup.call(erc20.address, 30, merkleRoot, unlockTime, {from: funder})
      await merkleBox.newClaimsGroup(erc20.address, 30, merkleRoot, unlockTime, {from: funder})
    })

    it('reverts when holding owner tries to claim', async () => {
      const proof = merkleTree.getHexProof(receipt(funder, 10))
      await expectRevert(merkleBox.claim(claimGroupId, funder, 10, proof, {from: funder}), 'Holding owner cannot claim')
    })

    it('isClaimable() returns false when holding owner tries to claim', async () => {
      const proof = merkleTree.getHexProof(receipt(funder, 10))
      expect(await merkleBox.isClaimable(claimGroupId, funder, 10, proof, {from: funder})).to.equal(false)
    })
  })

  context('when two claim groups have the same Merkle root', async () => {
    const merkleTree = new MerkleTree([receipt(recipient, 10), receipt(recipient2, 20)])
    const merkleRoot = merkleTree.getHexRoot()
    var claimGroupId1, claimGroupId2

    beforeEach(async () => {
      await erc20.approve(merkleBox.address, 1000, {from: funder})
      claimGroupId1 = await merkleBox.newClaimsGroup.call(erc20.address, 500, merkleRoot, unlockTime, {from: funder})
      await merkleBox.newClaimsGroup(erc20.address, 500, merkleRoot, unlockTime, {from: funder})
      claimGroupId2 = await merkleBox.newClaimsGroup.call(erc20.address, 500, merkleRoot, unlockTime, {from: funder})
      await merkleBox.newClaimsGroup(erc20.address, 500, merkleRoot, unlockTime, {from: funder})
    })

    it('isClaimable() returns true for recipient in both claim groups', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      expect(await merkleBox.isClaimable(claimGroupId1, recipient, 10, proof, {from: other})).to.equal(true)
      expect(await merkleBox.isClaimable(claimGroupId2, recipient, 10, proof, {from: other})).to.equal(true)
    })

    it('recipient can claim from first claim group', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      const tx = await merkleBox.claim(claimGroupId1, recipient, 10, proof, {from: recipient})
      expectEvent(tx, 'MerkleClaim', {account: recipient, erc20: erc20.address, amount: new BN(10)})
      assert.equal(await erc20.balanceOf(recipient), 10)
      assert.equal(await erc20.balanceOf(merkleBox.address), 990)
    })

    it('recipient can claim from second claim group', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      const tx = await merkleBox.claim(claimGroupId2, recipient, 10, proof, {from: recipient})
      expectEvent(tx, 'MerkleClaim', {account: recipient, erc20: erc20.address, amount: new BN(10)})
      assert.equal(await erc20.balanceOf(recipient), 10)
      assert.equal(await erc20.balanceOf(merkleBox.address), 990)
    })

    it('isClaimable() returns true for recipient in both claim groups', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      expect(await merkleBox.isClaimable(claimGroupId1, recipient, 10, proof, {from: other})).to.equal(true)
      expect(await merkleBox.isClaimable(claimGroupId2, recipient, 10, proof, {from: other})).to.equal(true)
    })

    it('after claiming from first claim group, isClaimable() returns false for first claim group and still returns true for second claim group', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      await merkleBox.claim(claimGroupId1, recipient, 10, proof, {from: recipient})
      expect(await merkleBox.isClaimable(claimGroupId1, recipient, 10, proof, {from: other})).to.equal(false)
      expect(await merkleBox.isClaimable(claimGroupId2, recipient, 10, proof, {from: other})).to.equal(true)
    })

    it('after claiming from one claim group, recipient can claim from the other claim group', async () => {
      const r = receipt(recipient, 10)
      const proof = merkleTree.getHexProof(r)
      await merkleBox.claim(claimGroupId1, recipient, 10, proof, {from: recipient})
      const tx = await merkleBox.claim(claimGroupId2, recipient, 10, proof, {from: recipient})
      expectEvent(tx, 'MerkleClaim', {account: recipient, erc20: erc20.address, amount: new BN(10)})
      assert.equal(await erc20.balanceOf(recipient), 20)
      assert.equal(await erc20.balanceOf(merkleBox.address), 980)
    })
  })
})
