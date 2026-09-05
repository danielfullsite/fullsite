'use strict'
const path = require('node:path')
const { verifyPackage } = require('../offline-ui/package-store')

// Runs even if someone calls electron-builder directly instead of npm build.
// A kiosk installer without its executable UI cannot satisfy cold offline boot.
module.exports = async context => {
  const bundle = verifyPackage(path.join(context.appDir || context.packager?.info?.appDir || path.resolve(__dirname, '..'), 'ui-bundle'))
  console.log(`[offline-ui] Packaging verified revision ${bundle.manifest.revision}`)
}
