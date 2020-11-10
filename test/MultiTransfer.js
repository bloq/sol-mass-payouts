'use strict'

const MultiTransfer = artifacts.require('MultiTransfer')
const ERC20Mock = artifacts.require('mocks/ERC20Mock')

const {expectRevert, constants} = require('@openzeppelin/test-helpers')
const {toBuffer, bufferToHex} = require('ethereumjs-util')

function e (receiver, amount) {
  const a = toBuffer(amount)
  return bufferToHex(Buffer.concat([toBuffer(receiver), Buffer.alloc(12 - a.length), a]))
}

contract('MultiTransfer', async accounts => {
  // eslint-disable-next-line no-unused-vars
  const [_, sender, receiver1, receiver2, receiver3] = accounts
  let erc20, mt

  beforeEach(async () => {
    erc20 = await ERC20Mock.new('Test', 'TEST', sender, 1000)
    mt = await MultiTransfer.new()
    await erc20.approve(mt.address, 1000, {from: sender})
  })

  it('reverts if ERC20 address is zero', async () => {
    await expectRevert(mt.multiTransfer(constants.ZERO_ADDRESS, 1000, [], {from: sender}), 'ERC20 address invalid')
  })

  it('reverts if amount is zero', async () => {
    await expectRevert(mt.multiTransfer(erc20.address, 0, [], {from: sender}), 'Input amount invalid')
  })

  it('reverts if total is less than amount', async () => {
    await expectRevert(mt.multiTransfer(erc20.address, 1000, [e(receiver1, 500), e(receiver2, 300), e(receiver3, 199)], {from: sender}), 'Output amt must equal input amt')
  })

  it('reverts if total is more than amount', async () => {
    await expectRevert(mt.multiTransfer(erc20.address, 999, [e(receiver1, 500), e(receiver2, 300), e(receiver3, 200)], {from: sender}), 'Output amt must equal input amt')
  })

  it('balances are correct', async () => {
    assert.equal(await erc20.balanceOf(sender), 1000)
    assert.equal(await erc20.balanceOf(receiver1), 0)
    assert.equal(await erc20.balanceOf(receiver2), 0)
    assert.equal(await erc20.balanceOf(receiver3), 0)
    await mt.multiTransfer(erc20.address, 1000, [e(receiver1, 500), e(receiver2, 300), e(receiver3, 200)], {from: sender})
    assert.equal(await erc20.balanceOf(sender), 0)
    assert.equal(await erc20.balanceOf(receiver1), 500)
    assert.equal(await erc20.balanceOf(receiver2), 300)
    assert.equal(await erc20.balanceOf(receiver3), 200)
  })
})
