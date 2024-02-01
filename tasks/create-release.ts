import { task } from 'hardhat/config'
import fs from 'fs'
import _ from 'lodash'
import { compareVersions } from 'compare-versions'

const readFileAsJson = (fileName: string) => JSON.parse(fs.readFileSync(fileName).toString())

const getAddress = (fileName: string) => readFileAsJson(fileName).address

const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

async function getImplAddress(proxyAddress: string) {
  const { ethers } = await import('hardhat')
  const implStorage = (await ethers.provider.getStorage(proxyAddress, IMPLEMENTATION_SLOT)).toString()
  if (implStorage.length === 42) {
    return ethers.getAddress(implStorage)
  }
  return ethers.getAddress(`0x${implStorage.slice(26)}`)
}

// Return deployment name and address
const getDeploymentData = async (dirName: string) => {
  const data = fs.readdirSync(dirName).map(function (fileName) {
    if (fileName.includes('.json')) {
      return {
        [fileName.split('.json')[0]]: getAddress(`${dirName}/${fileName}`),
      }
    }
    return {}
  })

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const mergedData = _.merge(...data)
  for (const [key, value] of Object.entries(mergedData)) {
    if (key.includes('_Proxy')) {
      const implKey = `${key.split('_Proxy')[0]}_Implementation`
      mergedData[implKey] = await getImplAddress(value)
    }
  }

  return Object.keys(mergedData)
    .sort()
    .reduce((sortedData, key) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      sortedData[key] = mergedData[key]
      return sortedData
    }, {})
}

function getPreviousRelease() {
  let releases = fs.readdirSync('releases')
  if (releases.length) {
    if (releases[0] === '.DS_Store') {
      releases.shift() // delete first element, generally found on mac machine.
    }
    releases = releases.sort(compareVersions)
    const prevRelease = releases[releases.length - 1]
    const preReleaseFile = `releases/${prevRelease}/contracts.json`
    if (fs.existsSync(preReleaseFile)) {
      return readFileAsJson(preReleaseFile)
    }
  }
  return {}
}

/* eslint-disable no-param-reassign */
task('create-release', 'Create release file from deploy data')
  .addParam('release', 'Release semantic version, i.e 1.2.3')
  .setAction(async function ({ release }, hre) {
    const network = hre.network.name
    console.log('Task args: release %s, network %s', release, network)

    const deploymentDir = `./deployments/${network}`
    // Read contract deployment name and address
    const deployData = await getDeploymentData(deploymentDir)

    // If this is first run then create releases directory
    if (!fs.existsSync('releases/')) {
      fs.mkdirSync('releases/')
    }

    const releaseDir = `releases/${release}`
    const releaseFile = `${releaseDir}/contracts.json`

    // Get previous release data
    const prevReleaseData = getPreviousRelease()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let releaseData: any = {}

    // If last stored release is same as current release
    if (prevReleaseData.version === release) {
      // Update release with new deployment
      releaseData = prevReleaseData
    } else {
      // If this is new release
      // Create new release directory if doesn't exist
      if (!fs.existsSync(releaseDir)) {
        fs.mkdirSync(releaseDir, { recursive: true })
      }
      // Copy data from previous release
      releaseData = prevReleaseData
      // Update release version
      releaseData.version = release
    }

    // We might have new network in this deployment, if not exist add empty network
    if (!releaseData.networks) {
      releaseData.networks = {}
      releaseData.networks[network] = {}
    } else if (!releaseData.networks[network]) {
      releaseData.networks[network] = {}
    }

    // Update release data with latest deployment
    releaseData.networks[network] = deployData
    // Write release data into file
    fs.writeFileSync(releaseFile, JSON.stringify(releaseData, null, 2))
    console.log(`${network} release ${release} is created successfully!`)
  })

module.exports = {}
