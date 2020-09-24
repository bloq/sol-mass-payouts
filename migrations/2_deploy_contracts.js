let MerkleBox = artifacts.require("MerkleBox")
module.exports = async function (deployer, network) {
    try {
        await deployer.deploy(MerkleBox)
    } catch (e) {
        console.log(`Error in migration: ${e.message}`)
    }
}
