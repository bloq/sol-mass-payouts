import { HardhatRuntimeEnvironment, HttpNetworkConfig } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const name = 'MultiTransfer'
const version = 'v1.1.0'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, run } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const deployed = await deploy(name, { from: deployer, log: true })

  const networkConfig = hre.network.config as unknown as HttpNetworkConfig
  if (hre.network.name !== 'localhost' && !networkConfig.url.includes('localhost')) {
    console.log('Verifying source code on the block explorer')
    try {
      await run('verify:verify', { address: deployed.address, noCompile: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      console.error('Contract verification failed for %s at %s', name, deployed.address, e.message)
    }
  }

  func.id = `${name}-${version}`
  return true
}

export default func
