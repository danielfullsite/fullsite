import { afterEach, describe, expect, it } from 'vitest'
import { getFingerprintUrl, setFingerprintUrl } from '@/lib/fingerprint-url'

describe('fingerprint service URL', () => {
  afterEach(() => setFingerprintUrl(null))

  it('uses Pedro proxy allowed by the POS CSP', () => {
    expect(getFingerprintUrl()).toBe('http://127.0.0.1:7717/fp')
  })

  it('still supports a provisioned override', () => {
    setFingerprintUrl('http://192.168.1.71:7717/fp')
    expect(getFingerprintUrl()).toBe('http://192.168.1.71:7717/fp')
  })
})
