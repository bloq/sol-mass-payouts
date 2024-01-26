import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const name = 'MultiTransfer'
const version = 'v1.1.0'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, run } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const deployed = await deploy(name, { from: deployer, log: true })

  if (hre.network.name !== 'localhost') {
    console.log('Verifying source code on the block explorer')
    await run('verify', { address: deployed.address, noCompile: true })
  }

  func.id = `${name}-${version}`
  return true
}

export default func
