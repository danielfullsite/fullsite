'use strict'

function invalid(primaryPath, errors) {
  return {
    valid: false,
    config: null,
    migrated: false,
    errors,
    sourcePath: primaryPath,
    legacy: null,
  }
}

/**
 * Load the terminal identity without allowing a stale legacy file to replace a
 * primary file that exists but is corrupt. Legacy is a migration source only
 * for installations where the primary file does not exist yet.
 */
function loadTerminalConfig({ fs, path, schema, primaryPath, legacyPath, logger = console }) {
  let primaryExists
  try {
    primaryExists = fs.existsSync(primaryPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('[config] Could not inspect primary config:', message)
    return invalid(primaryPath, [`Primary config unavailable: ${message}`])
  }

  if (primaryExists) {
    try {
      const data = JSON.parse(fs.readFileSync(primaryPath, 'utf8'))
      const result = schema.validate(data)
      if (!result.valid) {
        logger.warn('[config] Primary config invalid:', result.errors)
        return invalid(primaryPath, result.errors)
      }
      logger.log('[config] Valid config loaded from', primaryPath)
      schema.touchValidatedAt(data)
      return { valid: true, config: data, migrated: false, errors: [], sourcePath: primaryPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('[config] Error reading primary config:', message)
      return invalid(primaryPath, [`Primary config unreadable: ${message}`])
    }
  }

  let legacy = null
  try {
    if (fs.existsSync(legacyPath)) {
      legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'))
      logger.log('[config] Legacy config found at', legacyPath)

      const result = schema.validate(legacy)
      if (result.valid) {
        logger.log('[config] Legacy config is already valid new schema')
        return { valid: true, config: legacy, migrated: false, errors: [], sourcePath: legacyPath }
      }

      const migrated = schema.fromLegacy(legacy)
      if (migrated) {
        logger.log('[config] Auto-migrated legacy config:', JSON.stringify({
          restaurant_id: migrated.restaurant_id,
          terminal_id: migrated.terminal_id,
        }))
        try {
          fs.mkdirSync(path.dirname(primaryPath), { recursive: true })
          fs.writeFileSync(primaryPath, JSON.stringify(migrated, null, 2), 'utf8')
          logger.log('[config] Migrated config saved to', primaryPath)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn('[config] Could not save migrated config:', message)
        }
        return { valid: true, config: migrated, migrated: true, errors: [], sourcePath: primaryPath }
      }
      logger.warn('[config] Legacy config could not be migrated (missing restaurantId)')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('[config] Error reading legacy config:', message)
  }

  return {
    ...invalid(primaryPath, legacy
      ? ['Legacy config found but lacks a valid restaurant_id']
      : ['No config.json found']),
    legacy,
  }
}

module.exports = { loadTerminalConfig }
