/**
 * AMALAY's legacy /pos/mesas canvas was traced in a different coordinate
 * system from /pos/plano and from the generic editor seed. Applying persisted
 * coordinates there moves Toldo/Privado into the wrong zones.
 */
export function shouldUsePersistedFloorCoordinates(clientId: string): boolean {
  return clientId !== 'amalay'
}
