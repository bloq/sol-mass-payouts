import { expect } from 'chai'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers'
import { toBuffer, bufferToHex } from 'ethereumjs-util'

import { ERC20Mock, MultiTransfer } from '../typechain-types'

function encode(receiver: string, amount: bigint) {
  const a = toBuffer(ethers.toBeHex(amount))
  return bufferToHex(Buffer.concat([toBuffer(receiver), Buffer.alloc(12 - a.length), a]))
}

describe('MultiTransfer tests', function () {
  let erc20: ERC20Mock, mt: MultiTransfer
  let owner: SignerWithAddress, sender: SignerWithAddress
  let receiver1: SignerWithAddress, receiver2: SignerWithAddress, receiver3: SignerWithAddress

  before(async function () {
    // eslint-disable-next-line no-extra-semi
    ;[owner, sender, receiver1, receiver2, receiver3] = await ethers.getSigners()
  })

  beforeEach(async function () {
    const erc20Factory = await ethers.getContractFactory('ERC20Mock', owner)
    erc20 = await erc20Factory.deploy(sender, ethers.parseEther('1000'))
    await erc20.waitForDeployment()

    const mtFactory = await ethers.getContractFactory('MultiTransfer', owner)
    mt = (await mtFactory.deploy()) as MultiTransfer
    await mt.waitForDeployment()

    await erc20.connect(sender).approve(await mt.getAddress(), ethers.parseEther('1000'))
  })

  it('reverts if ERC20 address is zero', async function () {
    await expect(mt.multiTransfer(ethers.ZeroAddress, [])).to.revertedWith('ERC20 address invalid')
  })

  it('reverts if amount sent is too large', async function () {
    await expect(
      mt.multiTransfer(await erc20.getAddress(), [
        encode(receiver1.address, ethers.parseEther('500')),
        encode(receiver2.address, ethers.parseEther('1300')),
        encode(receiver3.address, ethers.parseEther('200')),
      ]),
      'ERC20: transfer amount exceeds balance',
    )
  })

  it('balances are correct', async function () {
    expect(await erc20.balanceOf(sender)).to.eq(ethers.parseEther('1000'))
    expect(await erc20.balanceOf(receiver1)).to.eq(0)
    expect(await erc20.balanceOf(receiver2)).to.eq(0)
    expect(await erc20.balanceOf(receiver3)).to.eq(0)

    await mt
      .connect(sender)
      .multiTransfer(await erc20.getAddress(), [
        encode(receiver1.address, ethers.parseEther('500')),
        encode(receiver2.address, ethers.parseEther('300')),
        encode(receiver3.address, ethers.parseEther('200')),
      ])

    expect(await erc20.balanceOf(sender)).to.eq(0)
    expect(await erc20.balanceOf(receiver1)).to.eq(ethers.parseEther('500'))
    expect(await erc20.balanceOf(receiver2)).to.eq(ethers.parseEther('300'))
    expect(await erc20.balanceOf(receiver3)).to.eq(ethers.parseEther('200'))
  })
})
