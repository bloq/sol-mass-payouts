import { HardhatUserConfig } from 'hardhat/types'
import '@nomicfoundation/hardhat-toolbox'
import 'hardhat-contract-sizer'
import 'hardhat-deploy'
import 'dotenv/config'

import './tasks/create-release'

let contractSizer

if (process.env.ENABLE_CONTRACT_SIZER === 'true') {
  contractSizer = {
    alphaSort: false,
    runOnCompile: true,
  }
}

const localhost = 'http://localhost:8545'
const nodeUrl = process.env.NODE_URL || localhost

const testMnemonic = 'test test test test test test test test test test test junk'
const mnemonic = process.env.MNEMONIC || testMnemonic

let accounts: { mnemonic: string } | [string] = { mnemonic }

if (process.env.PRIVATE_KEY) {
  accounts = [process.env.PRIVATE_KEY]
}

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  contractSizer,
  gasReporter: {
    enabled: process.env.ENABLE_GAS_REPORTER === 'true',
    noColors: true,
  },
  networks: {
    // Prepare hardhat network based on provided NODE_URL and BLOCK_NUMBER
    hardhat: process.env.NODE_URL
      ? {
          forking: {
            url: process.env.NODE_URL,
            blockNumber: process.env.BLOCK_NUMBER ? parseInt(process.env.BLOCK_NUMBER) : undefined,
          },
        }
      : {},
    localhost: {
      url: localhost,
      accounts,
      saveDeployments: true,
    },
    mainnet: {
      url: nodeUrl,
      chainId: 1,
      accounts,
      saveDeployments: true,
    },
    hemi: {
      url: nodeUrl,
      chainId: 743111,
      accounts,
      saveDeployments: true,
    },
  },

  sourcify: {
    enabled: false,
  },

  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || '',
      hemi: 'noApiKeyNeeded',
    },
    customChains: [
      {
        network: 'hemi',
        chainId: 743111,
        urls: {
          apiURL: 'https://testnet.explorer.hemi.network/api',
          browserURL: 'https://testnet.explorer.hemi.network',
        },
      },
    ],
  },

  namedAccounts: {
    deployer: process.env.DEPLOYER || 0,
  },

  solidity: {
    version: '0.8.15',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
}

export default config
