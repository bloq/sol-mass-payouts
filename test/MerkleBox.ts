import { expect } from 'chai'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { ecsign } from 'ethereumjs-util'
import { MerkleTree } from 'merkletreejs'

import { ERC20WithPermitMock, MerkleBox } from '../typechain-types'

const { parseEther, solidityPackedKeccak256 } = ethers

describe('MerkleBox tests', function () {
  let erc20: ERC20WithPermitMock, merkleBox: MerkleBox
  let owner: SignerWithAddress, funder: SignerWithAddress, funder2: SignerWithAddress, funder3: SignerWithAddress
  let recipient: SignerWithAddress, recipient2: SignerWithAddress, other: SignerWithAddress
  let unlockTime: number

  function leave(recipient1: SignerWithAddress, amount: bigint) {
    return solidityPackedKeccak256(['address', 'uint256'], [recipient1.address, amount])
  }

  function createMerkleTree(leaves: string[]) {
    return new MerkleTree(leaves, ethers.keccak256)
  }

  function getProof(tree: MerkleTree, recipient: SignerWithAddress, amount: bigint) {
    return tree.getHexProof(leave(recipient, amount))
  }

  before(async function () {
    // eslint-disable-next-line no-extra-semi
    ;[owner, funder, funder2, funder3, recipient, recipient2, other] = await ethers.getSigners()
  })

  beforeEach(async function () {
    const mbFactory = await ethers.getContractFactory('MerkleBox', owner)
    merkleBox = (await mbFactory.deploy()) as MerkleBox
    await merkleBox.waitForDeployment()

    const erc20Factory = await ethers.getContractFactory('ERC20WithPermitMock', owner)
    erc20 = await erc20Factory.deploy(owner, parseEther('5000'))
    await erc20.waitForDeployment()

    await erc20.transfer(funder, parseEther('1000'))
    await erc20.transfer(funder2, parseEther('1000'))
    await erc20.transfer(funder3, parseEther('1000'))
    // funder3PrivateKey = '0xa11a58ba8887796d1a7bc2a6107a98e0befd2b10c8846a39f39c05c6a976e725'
    // funder3 = '0xA73Ead6953c1464d6F7Ce14E718cc8d8EE531e05'

    unlockTime = (await time.latest()) + time.duration.weeks(5)
  })

  context('before a claims group is created', function () {
    let merkleTree: MerkleTree
    before(async function () {
      merkleTree = createMerkleTree([leave(recipient, parseEther('10')), leave(recipient2, parseEther('20'))])
    })

    it('reverts when attempting to add funds to unknown claims group', async function () {
      await erc20.connect(funder2).approve(merkleBox, parseEther('50'))
      const claimGroupId = 42
      await expect(merkleBox.connect(funder2).addFunds(claimGroupId, 50)).to.revertedWith('Holding does not exist')
    })

    it('isClaimable() returns false for an unknown claims group', async function () {
      const amount = parseEther('10')
      const proof = getProof(merkleTree, recipient, amount)
      const claimGroupId = 42
      expect(await merkleBox.isClaimable(claimGroupId, recipient, amount, proof)).to.equal(false)
    })

    it('reverts when claiming from an unknown claims group', async function () {
      const amount = parseEther('10')
      const proof = getProof(merkleTree, recipient, amount)
      const claimGroupId = 42
      await expect(merkleBox.connect(recipient).claim(claimGroupId, recipient, amount, proof)).to.revertedWith(
        'Holding not found',
      )
    })
  })

  context('when creating a new claims group', function () {
    let merkleTree: MerkleTree
    let merkleRoot: string
    let amount: bigint
    const memo = 'datasetUri=http://test.com/json'
    before(async function () {
      merkleTree = createMerkleTree([leave(recipient, parseEther('10')), leave(recipient2, parseEther('20'))])
      merkleRoot = merkleTree.getHexRoot()
      amount = parseEther('1000')
    })

    beforeEach(async function () {
      // Connect funder to contracts
      merkleBox = merkleBox.connect(funder)
      erc20 = erc20.connect(funder)
      await erc20.approve(merkleBox, amount)
    })

    it('emits NewMerkle event and deposits funds', async function () {
      const tx = await merkleBox.newClaimsGroup(erc20, amount, merkleRoot, unlockTime, memo)
      await expect(tx).to.emit(merkleBox, 'NewMerkle').withArgs(funder, erc20, amount, merkleRoot, 1n, unlockTime, memo)
      await expect(tx).to.changeTokenBalances(erc20, [funder, merkleBox], [amount * -1n, amount])
    })

    it('reverts if ERC20 address is zero', async function () {
      await expect(merkleBox.newClaimsGroup(ethers.ZeroAddress, amount, merkleRoot, unlockTime, '')).to.revertedWith(
        'Invalid ERC20 address',
      )
    })

    it('reverts if merkleRoot is zero', async function () {
      await expect(merkleBox.newClaimsGroup(erc20, 1000, ethers.ZeroHash, unlockTime, '')).to.revertedWith(
        'Merkle cannot be zero',
      )
    })

    it('reverts if withdraw lock time is less than minimum', async function () {
      const errorMessage = 'Holding lock must exceed minimum lock period'
      await expect(merkleBox.newClaimsGroup(erc20, 1000, merkleRoot, 0, '')).to.revertedWith(errorMessage)
    })

    it('reverts if insufficient balance', async function () {
      await expect(merkleBox.newClaimsGroup(erc20, amount + 1n, merkleRoot, unlockTime, '')).to.revertedWith(
        'Insufficient balance',
      )
    })

    it('reverts if amount is zero', async function () {
      await expect(merkleBox.newClaimsGroup(erc20, 0, merkleRoot, unlockTime, '')).to.revertedWith(
        'Amount cannot be zero',
      )
    })
  })

  context('after creating a claims group', function () {
    let merkleTree: MerkleTree
    let merkleRoot: string
    let amount: bigint
    let claimGroupId: bigint
    let recipientAmount: bigint
    let recipient2Amount: bigint
    before(async function () {
      recipientAmount = parseEther('10')
      recipient2Amount = parseEther('20')
      merkleTree = createMerkleTree([leave(recipient, recipientAmount), leave(recipient2, recipient2Amount)])
      merkleRoot = merkleTree.getHexRoot()
      amount = parseEther('1000')
    })

    beforeEach(async function () {
      // funder is creating merkle claim group
      merkleBox = merkleBox.connect(funder)
      erc20 = erc20.connect(funder)
      await erc20.approve(merkleBox, amount)
      claimGroupId = await merkleBox.newClaimsGroup.staticCall(erc20, amount, merkleRoot, unlockTime, '')

      await merkleBox.newClaimsGroup(erc20, amount, merkleRoot, unlockTime, '')

      // Connect funder2 with contracts
      merkleBox = merkleBox.connect(funder2)
      erc20 = erc20.connect(funder2)
    })

    it('funder cannot withdraw', async function () {
      await expect(merkleBox.connect(funder).withdrawFunds(claimGroupId, parseEther('50'))).to.revertedWith(
        'Holdings may not be withdrawn',
      )
    })

    it('should get list of claim ids', async function () {
      await erc20.approve(merkleBox, amount)
      await merkleBox.newClaimsGroup(erc20, amount / 2n, merkleRoot, unlockTime, '')
      await merkleBox.newClaimsGroup(erc20, amount / 2n, merkleRoot, unlockTime, '')
      const ids = await merkleBox.getClaimGroupIds(funder2)
      expect(ids.length).to.eq(2)
    })

    it('funder cannot withdraw-all', async function () {
      await expect(merkleBox.connect(funder).withdrawFunds(claimGroupId, ethers.MaxUint256)).to.revertedWith(
        'Holdings may not be withdrawn',
      )
    })

    it('anyone can add funds', async function () {
      const amount2 = parseEther('50')
      await erc20.approve(merkleBox, amount2)
      const tx = await merkleBox.addFunds(claimGroupId, amount2)
      await expect(tx)
        .to.emit(merkleBox, 'MerkleFundUpdate')
        .withArgs(funder2, merkleRoot, claimGroupId, amount2, false)
      await expect(tx).to.changeTokenBalances(erc20, [funder2, merkleBox], [amount2 * -1n, amount2])
    })

    it('anyone can add funds with deposit-all (amount = -1)', async function () {
      const amount2 = parseEther('1000')
      await erc20.approve(merkleBox, amount2)
      const tx = await merkleBox.addFunds(claimGroupId, ethers.MaxUint256)
      await expect(tx)
        .to.emit(merkleBox, 'MerkleFundUpdate')
        .withArgs(funder2, merkleRoot, claimGroupId, amount2, false)
      await expect(tx).to.changeTokenBalances(erc20, [funder2, merkleBox], [amount2 * -1n, amount2])
    })

    it('anyone can add funds with permit', async function () {
      const amount2 = parseEther('50')
      const deadline = ethers.MaxUint256
      const digest = await erc20.getPermitDigest(funder3, merkleBox, amount2, deadline)
      const privateKey = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
      const wallet = new ethers.Wallet(privateKey)
      if (wallet.address !== funder3.address) {
        throw new Error('Private key does not match with signer')
      }
      const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(privateKey.slice(2), 'hex'))
      const tx = await merkleBox.connect(other).addFundsWithPermit(claimGroupId, funder3, amount2, deadline, v, r, s)

      await expect(tx)
        .to.emit(merkleBox, 'MerkleFundUpdate')
        .withArgs(funder3, merkleRoot, claimGroupId, amount2, false)
      await expect(tx).to.changeTokenBalances(erc20, [funder3, merkleBox], [amount2 * -1n, amount2])
    })

    it('reverts when attempting to add funds with amount = 0', async function () {
      const deadline = ethers.MaxUint256
      const digest = await erc20.getPermitDigest(funder3, merkleBox, 0, deadline)
      const privateKey = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
      const wallet = new ethers.Wallet(privateKey)
      if (wallet.address !== funder3.address) {
        throw new Error('Private key does not match with signer')
      }
      const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(privateKey.slice(2), 'hex'))
      await expect(
        merkleBox.connect(other).addFundsWithPermit(claimGroupId, funder3, 0, deadline, v, r, s),
      ).to.revertedWith('Invalid amount')
    })

    it('reverts when attempting to add funds with permit and amount = 0', async function () {
      const amount2 = parseEther('50')
      await erc20.approve(merkleBox, amount2)
      await expect(merkleBox.addFunds(claimGroupId, 0)).to.revertedWith('Invalid amount')
    })

    it('recipient can claim', async function () {
      const proof = getProof(merkleTree, recipient, recipientAmount)
      const tx = await merkleBox.connect(recipient).claim(claimGroupId, recipient, recipientAmount, proof)
      await expect(tx).to.emit(merkleBox, 'MerkleClaim').withArgs(recipient, erc20, recipientAmount)
      await expect(tx).to.changeTokenBalances(erc20, [recipient, merkleBox], [recipientAmount, recipientAmount * -1n])
    })

    it('revert if amount is wrong', async function () {
      const proof = getProof(merkleTree, recipient, recipientAmount)
      await expect(merkleBox.claim(claimGroupId, recipient, recipientAmount + 1n, proof), 'Claim not found')
    })

    it('other account can claim on behalf of recipient', async function () {
      const proof = getProof(merkleTree, recipient2, recipient2Amount)
      const tx = await merkleBox.connect(other).claim(claimGroupId, recipient2, recipient2Amount, proof)
      await expect(tx).to.emit(merkleBox, 'MerkleClaim').withArgs(recipient2, erc20, recipient2Amount)
      await expect(tx).to.changeTokenBalances(
        erc20,
        [recipient2, merkleBox],
        [recipient2Amount, recipient2Amount * -1n],
      )
    })

    it('recipient cannot claim twice', async function () {
      const proof = getProof(merkleTree, recipient, recipientAmount)
      await merkleBox.connect(recipient).claim(claimGroupId, recipient, recipientAmount, proof)
      await expect(merkleBox.connect(recipient).claim(claimGroupId, recipient, recipientAmount, proof)).to.revertedWith(
        'Already claimed',
      )
    })

    it('isClaimable() returns true for a valid and unclaimed Merkle proof', async function () {
      const proof = getProof(merkleTree, recipient, recipientAmount)
      expect(await merkleBox.isClaimable(claimGroupId, recipient, recipientAmount, proof)).to.equal(true)
    })

    it('isClaimable() returns false for a valid but already claimed Merkle proof', async function () {
      const proof = getProof(merkleTree, recipient, recipientAmount)
      await merkleBox.connect(recipient).claim(claimGroupId, recipient, recipientAmount, proof)
      expect(await merkleBox.isClaimable(claimGroupId, recipient, recipientAmount, proof)).to.equal(false)
    })

    it('reverts when claiming with an invalid Merkle proof', async function () {
      const l = leave(recipient, parseEther('42'))
      const newTree = new MerkleTree([l, leave(recipient2, parseEther('23'))])
      const proof = newTree.getHexProof(l)
      await expect(merkleBox.claim(claimGroupId, recipient, parseEther('42'), proof)).to.revertedWith('Claim not found')
    })

    it('isClaimable() returns false for an invalid Merkle proof', async function () {
      const l = leave(recipient, parseEther('42'))
      const newTree = new MerkleTree([l, leave(recipient2, parseEther('23'))])
      const proof = newTree.getHexProof(l)
      expect(await merkleBox.isClaimable(claimGroupId, recipient, parseEther('42'), proof)).to.equal(false)
    })

    it('reverts when claiming with a Merkle proof of invalid length', async function () {
      let proof = getProof(merkleTree, recipient, recipientAmount)
      proof = proof.slice(0, proof.length - 5)
      await expect(merkleBox.claim(claimGroupId, recipient, recipientAmount, proof)).to.revertedWith('Claim not found')
    })

    it('isClaimable() returns false for a Merkle proof of invalid length', async function () {
      let proof = getProof(merkleTree, recipient, recipientAmount)
      proof = proof.slice(0, proof.length - 5)
      expect(await merkleBox.isClaimable(claimGroupId, recipient, recipientAmount, proof)).to.equal(false)
    })

    it('can create a second claims group with the same Merkle root', async function () {
      await erc20.connect(funder2).approve(merkleBox, amount)
      const tx = await merkleBox.connect(funder2).newClaimsGroup(erc20, amount, merkleRoot, unlockTime, '')
      await expect(tx).to.emit(merkleBox, 'NewMerkle').withArgs(funder2, erc20, amount, merkleRoot, 2n, unlockTime, '')
      await expect(tx).to.changeTokenBalances(erc20, [funder2, merkleBox], [amount * -1n, amount])
    })

    context('when unlock time is reached', function () {
      beforeEach(async function () {
        await time.increaseTo(unlockTime)
        // Connect funder with contracts
        merkleBox = merkleBox.connect(funder)
        erc20 = erc20.connect(funder)
      })

      it('funder can withdraw', async function () {
        const amount2 = parseEther('50')
        const tx = await merkleBox.withdrawFunds(claimGroupId, amount2)
        await expect(tx)
          .to.emit(merkleBox, 'MerkleFundUpdate')
          .withArgs(funder, merkleRoot, claimGroupId, amount2, true)
        await expect(tx).to.changeTokenBalances(erc20, [funder, merkleBox], [amount2, amount2 * -1n])
      })

      it('funder can withdraw-all (amount = -1)', async function () {
        const amount2 = parseEther('50')
        await merkleBox.withdrawFunds(claimGroupId, amount2)

        const tx = await merkleBox.withdrawFunds(claimGroupId, ethers.MaxUint256)
        const changeInBalance = amount - amount2
        await expect(tx)
          .to.emit(merkleBox, 'MerkleFundUpdate')
          .withArgs(funder, merkleRoot, claimGroupId, changeInBalance, true)
        await expect(tx).to.changeTokenBalances(erc20, [funder, merkleBox], [changeInBalance, changeInBalance * -1n])
      })

      it('funder cannot over-withdraw', async function () {
        await expect(merkleBox.withdrawFunds(claimGroupId, amount + 1n)).to.revertedWith('Insufficient balance')
      })

      it('other cannot withdraw', async function () {
        await expect(merkleBox.connect(other).withdrawFunds(claimGroupId, amount)).to.revertedWith(
          'Only owner may withdraw',
        )
      })

      it('recipient can claim', async function () {
        const proof = getProof(merkleTree, recipient, recipientAmount)
        const tx = await merkleBox.connect(recipient).claim(claimGroupId, recipient, recipientAmount, proof)
        await expect(tx).to.emit(merkleBox, 'MerkleClaim').withArgs(recipient, erc20, recipientAmount)
        await expect(tx).to.changeTokenBalances(erc20, [recipient, merkleBox], [recipientAmount, recipientAmount * -1n])
      })
    })
  })

  context('when a claims group is underfunded', function () {
    let merkleTree: MerkleTree
    let merkleRoot: string
    let amount: bigint
    let claimGroupId: bigint
    let recipientAmount: bigint
    let recipient2Amount: bigint
    before(async function () {
      recipientAmount = parseEther('10')
      recipient2Amount = parseEther('20')
      merkleTree = createMerkleTree([leave(recipient, recipientAmount), leave(recipient2, recipient2Amount)])
      merkleRoot = merkleTree.getHexRoot()
      amount = parseEther('29')
    })

    beforeEach(async function () {
      // funder is creating merkle claim group
      merkleBox = merkleBox.connect(funder)
      erc20 = erc20.connect(funder)
      await erc20.approve(merkleBox, amount)
      claimGroupId = await merkleBox.newClaimsGroup.staticCall(erc20, amount, merkleRoot, unlockTime, '')

      await merkleBox.newClaimsGroup(erc20, amount, merkleRoot, unlockTime, '')

      const proof = merkleTree.getHexProof(leave(recipient2, recipient2Amount))
      await merkleBox.connect(recipient2).claim(claimGroupId, recipient2, recipient2Amount, proof)
    })

    it('cannot claim when not enough balance', async function () {
      const proof = merkleTree.getHexProof(leave(recipient, recipientAmount))
      await expect(merkleBox.claim(claimGroupId, recipient, recipientAmount, proof)).to.revertedWith(
        'Claim under-funded by funder.',
      )
    })

    it('can claim after funds are added', async function () {
      await erc20.connect(funder2).approve(merkleBox, parseEther('1'))
      await merkleBox.connect(funder2).addFunds(claimGroupId, parseEther('1'))
      const proof = merkleTree.getHexProof(leave(recipient, recipientAmount))
      const tx = await merkleBox.connect(recipient).claim(claimGroupId, recipient, recipientAmount, proof)
      await expect(tx).to.emit(merkleBox, 'MerkleClaim').withArgs(recipient, erc20, recipientAmount)
      await expect(tx).to.changeTokenBalances(erc20, [recipient, merkleBox], [recipientAmount, recipientAmount * -1n])
    })
  })

  context('when a claims group has owner address in Merkle', function () {
    let merkleTree: MerkleTree
    let merkleRoot: string
    let amount: bigint
    let claimGroupId: bigint
    let funderAmount: bigint
    before(async function () {
      funderAmount = parseEther('10')
      merkleTree = createMerkleTree([leave(funder, funderAmount), leave(recipient2, parseEther('20'))])
      merkleRoot = merkleTree.getHexRoot()
      amount = parseEther('30')
    })

    beforeEach(async function () {
      // funder is creating merkle claim group
      merkleBox = merkleBox.connect(funder)
      erc20 = erc20.connect(funder)
      await erc20.approve(merkleBox, amount)
      claimGroupId = await merkleBox.newClaimsGroup.staticCall(erc20, amount, merkleRoot, unlockTime, '')
      await merkleBox.newClaimsGroup(erc20, amount, merkleRoot, unlockTime, '')
    })

    it('reverts when holding owner tries to claim', async function () {
      const proof = merkleTree.getHexProof(leave(funder, funderAmount))
      await expect(merkleBox.claim(claimGroupId, funder, funderAmount, proof)).to.revertedWith(
        'Holding owner cannot claim',
      )
    })

    it('isClaimable() returns false when holding owner tries to claim', async function () {
      const proof = merkleTree.getHexProof(leave(funder, funderAmount))
      expect(await merkleBox.isClaimable(claimGroupId, funder, funderAmount, proof)).to.equal(false)
    })
  })

  context('when two claim groups have the same Merkle root', function () {
    let merkleTree: MerkleTree
    let merkleRoot: string
    let amount: bigint
    let claimGroupId1: bigint
    let claimGroupId2: bigint
    let recipientAmount: bigint
    let recipient2Amount: bigint
    before(async function () {
      recipientAmount = parseEther('10')
      recipient2Amount = parseEther('20')
      merkleTree = createMerkleTree([leave(recipient, recipientAmount), leave(recipient2, recipient2Amount)])
      merkleRoot = merkleTree.getHexRoot()
      amount = parseEther('500')
    })

    beforeEach(async function () {
      // funder is creating merkle claim group
      merkleBox = merkleBox.connect(funder)
      erc20 = erc20.connect(funder)
      await erc20.approve(merkleBox, amount * 2n)
      claimGroupId1 = await merkleBox.newClaimsGroup.staticCall(erc20, amount, merkleRoot, unlockTime, '')
      await merkleBox.newClaimsGroup(erc20, amount, merkleRoot, unlockTime, '')

      claimGroupId2 = await merkleBox.newClaimsGroup.staticCall(erc20, amount, merkleRoot, unlockTime, '')
      await merkleBox.newClaimsGroup(erc20, amount, merkleRoot, unlockTime, '')
    })

    it('isClaimable() returns true for recipient in both claim groups', async function () {
      const proof = merkleTree.getHexProof(leave(recipient, recipientAmount))
      expect(await merkleBox.isClaimable(claimGroupId1, recipient, recipientAmount, proof)).to.equal(true)
      expect(await merkleBox.isClaimable(claimGroupId2, recipient, recipientAmount, proof)).to.equal(true)
    })

    it('recipient can claim from first claim group', async function () {
      const proof = merkleTree.getHexProof(leave(recipient, recipientAmount))
      const tx = await merkleBox.connect(recipient).claim(claimGroupId1, recipient, recipientAmount, proof)
      await expect(tx).to.emit(merkleBox, 'MerkleClaim').withArgs(recipient, erc20, recipientAmount)
      await expect(tx).to.changeTokenBalances(erc20, [recipient, merkleBox], [recipientAmount, recipientAmount * -1n])
    })

    it('recipient can claim from second claim group', async function () {
      const proof = merkleTree.getHexProof(leave(recipient, recipientAmount))
      const tx = await merkleBox.connect(recipient).claim(claimGroupId2, recipient, recipientAmount, proof)
      await expect(tx).to.emit(merkleBox, 'MerkleClaim').withArgs(recipient, erc20, recipientAmount)
      await expect(tx).to.changeTokenBalances(erc20, [recipient, merkleBox], [recipientAmount, recipientAmount * -1n])
    })

    it('isClaimable() returns true for recipient2 in both claim groups', async function () {
      const proof = merkleTree.getHexProof(leave(recipient2, recipient2Amount))
      expect(await merkleBox.isClaimable(claimGroupId1, recipient2, recipient2Amount, proof)).to.equal(true)
      expect(await merkleBox.isClaimable(claimGroupId2, recipient2, recipient2Amount, proof)).to.equal(true)
    })

    it('after claiming from first claim group, isClaimable() returns false for first claim group and still returns true for second claim group', async function () {
      const proof = merkleTree.getHexProof(leave(recipient2, recipient2Amount))
      await merkleBox.connect(recipient2).claim(claimGroupId1, recipient2, recipient2Amount, proof)
      expect(await merkleBox.isClaimable(claimGroupId1, recipient2, recipient2Amount, proof)).to.equal(false)
      expect(await merkleBox.isClaimable(claimGroupId2, recipient2, recipient2Amount, proof)).to.equal(true)
    })

    it('after claiming from one claim group, recipient can claim from the other claim group', async function () {
      const proof = merkleTree.getHexProof(leave(recipient2, recipient2Amount))
      await merkleBox.connect(recipient2).claim(claimGroupId1, recipient2, recipient2Amount, proof)
      const tx = await merkleBox.connect(recipient2).claim(claimGroupId2, recipient2, recipient2Amount, proof)
      await expect(tx).to.emit(merkleBox, 'MerkleClaim').withArgs(recipient2, erc20, recipient2Amount)
      await expect(tx).to.changeTokenBalances(
        erc20,
        [recipient2, merkleBox],
        [recipient2Amount, recipient2Amount * -1n],
      )
    })
  })
})
