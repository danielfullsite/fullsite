'use strict'
// Local queues and the confirmed business cursor are not present in a salon
// snapshot. Both update consumers must use this live, synchronous provider.
function buildInstallSnapshot({ state, eventStore, printer, config = {}, businessSync = null, getBusinessSyncStatus }) {
  const snapshot = state.toSnapshot()
  const stats = eventStore.getStats()
  const status = typeof getBusinessSyncStatus === 'function' ? getBusinessSyncStatus() : null
  const jobs = printer?.getQueue?.()
  return { ...snapshot, install_readiness: {
    primary: !config.posServerIp && (!config.terminalRole || config.terminalRole === 'server_pos'),
    authority_required: config.localAuthorityEnabled === true,
    storage_available: stats?.storageUnavailable === false,
    commands_in_flight: stats?.commandsInFlight,
    last_sequence: stats?.lastSequence,
    business_required: config.localAuthorityEnabled === true || !!businessSync,
    business_sync: status,
    // The local adapter always initializes a durable queue, including legacy
    // installs without configured printers. Missing queue access is not idle.
    print_jobs: Array.isArray(jobs) ? jobs.map(job => ({ status: job.status })) : null,
  } }
}
module.exports = { buildInstallSnapshot }
