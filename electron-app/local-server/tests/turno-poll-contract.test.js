'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')

test('Supabase poll loads active shifts instead of forcing turno null', () => {
  assert.match(source, /pos_turnos\?client_id=eq\./)
  assert.match(source, /closed_at=is\.null/)
  assert.doesNotMatch(source, /turno:\s+null,\s*\/\/ TODO: fetch active turno separately/)
})

test('KDS poll isolates orders to the newest active shift', () => {
  assert.match(source, /orders\.filter\(order => order\.turno_id === activeTurno\.id\)/)
  assert.match(source, /conflict_count: activeTurnos\.length/)
  assert.match(source, /operationalOrders\.filter/)
})
