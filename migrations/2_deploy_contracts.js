let MerkleBox = artifacts.require("MerkleBox")
let MultiTransfer = artifacts.require("MultiTransfer")
module.exports = async function (deployer, network) {
    try {
        await deployer.deploy(MerkleBox)
        await deployer.deploy(MultiTransfer)
    } catch (e) {
        console.log(`Error in migration: ${e.message}`)
    }
}
