import {it,expect} from 'vitest'
import {randomPin10} from '@/lib/provision-tenant'
it('template PINs are independent random ten-digit credentials',()=>{
 const pins=Array.from({length:20},()=>randomPin10())
 expect(pins.every(pin=>/^[1-9][0-9]{9}$/.test(pin))).toBe(true)
 expect(new Set(pins).size).toBe(pins.length)
})
