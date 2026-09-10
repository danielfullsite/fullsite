'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildHttpRouter } = require('../index')
const cred = require('../core/credencial-lan')
const secret = cred.generarSecreto()
const headers = cred.cabecerasDeCredencial({ secreto:secret, restaurantId:'lab', terminalId:'pos2' })
function setup(role='admin') {
  const turno={id:'t',opening_cash_cents:100}
  return buildHttpRouter({ restaurantId:'lab', config:{lanSecret:secret},
    state:{toSnapshot:()=>({write_authority:'caja',turno,turn_summaries:[],salon_orders:[]}),getFinancialOrders:()=>[],getCashMovements:()=>[]},
    eventStore:{getLastSequence:async()=>3},
    actorAuthority:{verify(token,device){assert.equal(device,'pos2'); if(token!=='signed-lab') throw new Error('Invalid actor'); return {permissions:role==='admin'?['corte_x']:[]} }},
  })
}
async function get(router, actor) {
  const req={url:'/reports/turn',method:'GET',headers:{...headers,...(actor?{'x-fullsite-actor':actor}:{})},socket:{remoteAddress:'127.0.0.1'}}
  const res={statusCode:0,body:'',setHeader(){},writeHead(code){this.statusCode=code},end(body){this.body=body}}
  await router(req,res); return res
}
test('transport credential alone is not a report permission',async()=>{
  assert.equal((await get(setup())).statusCode,403)
  assert.equal((await get(setup('mesero'),'signed-lab')).statusCode,403)
})
test('verified report permission reads X without closing the turno',async()=>{
  const res=await get(setup(),'signed-lab')
  assert.equal(res.statusCode,200)
  const body=JSON.parse(res.body)
  assert.equal(body.closed,false)
  assert.equal(body.report.expected_cash_cents,100)
  assert.equal(body.sequence,3)
})
