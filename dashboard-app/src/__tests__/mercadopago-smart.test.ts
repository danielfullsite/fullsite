import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getMPConfig,
  saveMPConfig,
  clearMPConfig,
  isPointSmart,
  detectDeviceModel,
  type MPConfig,
  type MPDevice,
  type DeviceModel,
} from '@/lib/mercadopago'

// ─── localStorage + window mock ───────────────────────────────────────────

const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)
// getMPConfig checks typeof window !== 'undefined'
vi.stubGlobal('window', {})

beforeEach(() => localStorageMock.clear())

// ─── MPConfig persistence ──────────────────────────────────────────────────

describe('MPConfig', () => {
  it('returns null when no config saved', () => {
    expect(getMPConfig()).toBeNull()
  })

  it('saves and retrieves config', () => {
    const config: MPConfig = { accessToken: 'tok_123', deviceId: 'dev_abc', deviceModel: 'SMART' }
    saveMPConfig(config)
    const result = getMPConfig()
    expect(result).toEqual(config)
  })

  it('clears config', () => {
    saveMPConfig({ accessToken: 'tok', deviceId: 'dev', deviceModel: 'MINI' })
    clearMPConfig()
    expect(getMPConfig()).toBeNull()
  })

  it('migrates old config without deviceModel', () => {
    // Simulate old config without deviceModel
    localStorageMock.setItem('mp_point_config', JSON.stringify({ accessToken: 'tok', deviceId: 'dev' }))
    const config = getMPConfig()
    expect(config).not.toBeNull()
    expect(config!.deviceModel).toBe('UNKNOWN')
  })
})

// ─── isPointSmart ──────────────────────────────────────────────────────────

describe('isPointSmart', () => {
  it('returns true for SMART model', () => {
    saveMPConfig({ accessToken: 'tok', deviceId: 'dev', deviceModel: 'SMART' })
    expect(isPointSmart()).toBe(true)
  })

  it('returns false for MINI model', () => {
    saveMPConfig({ accessToken: 'tok', deviceId: 'dev', deviceModel: 'MINI' })
    expect(isPointSmart()).toBe(false)
  })

  it('returns false when no config', () => {
    expect(isPointSmart()).toBe(false)
  })
})

// ─── detectDeviceModel ─────────────────────────────────────────────────────

describe('detectDeviceModel', () => {
  const makeDevice = (overrides: Partial<MPDevice> = {}): MPDevice => ({
    id: 'dev_1',
    pos_id: 1,
    store_id: 'store_1',
    external_pos_id: 'ext_1',
    operating_mode: 'STANDALONE',
    ...overrides,
  })

  it('detects SMART from model string', () => {
    expect(detectDeviceModel(makeDevice({ model: 'SMART' }))).toBe('SMART')
    expect(detectDeviceModel(makeDevice({ model: 'Point Smart' }))).toBe('SMART')
    expect(detectDeviceModel(makeDevice({ model: 'S1' }))).toBe('SMART')
  })

  it('detects MINI from model string', () => {
    expect(detectDeviceModel(makeDevice({ model: 'MINI' }))).toBe('MINI')
    expect(detectDeviceModel(makeDevice({ model: 'Point Mini' }))).toBe('MINI')
    expect(detectDeviceModel(makeDevice({ model: 'M1' }))).toBe('MINI')
  })

  it('detects SMART from PDV operating mode', () => {
    expect(detectDeviceModel(makeDevice({ operating_mode: 'PDV' }))).toBe('SMART')
  })

  it('returns UNKNOWN for unrecognized devices', () => {
    expect(detectDeviceModel(makeDevice())).toBe('UNKNOWN')
    expect(detectDeviceModel(makeDevice({ model: 'SomethingElse' }))).toBe('UNKNOWN')
  })
})
