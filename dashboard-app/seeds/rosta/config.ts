import type { RestaurantSeed } from '../_lib/types.ts'

/**
 * ROSTA — demo para Daniel Olivares, Director División Restaurantes de Diezmex
 * Grupo Empresarial (Monterrey). Conectó por LinkedIn el 2026-08-27.
 *
 * Diezmex opera cinco marcas: Rosta, Café Macadam, Tacos Manteca, Atletico Cafe
 * y Casa Oso. Esta demo monta UNA de ellas.
 *
 * POR QUÉ UNA SOLA Y NO LAS CINCO
 * El producto todavía no puede separar datos por sucursal. Verificado contra
 * producción el 2026-08-27: `pos_orders.location_id` existe y está lleno en las
 * 6,328 órdenes, pero las CUATRO vistas OCM —ocm_daily, ocm_waiter_rankings,
 * ocm_menu_items, ocm_menu_groups— agrupan sólo por client_id. Esas vistas son
 * las que alimentan el dashboard, los agentes y el chat.
 *
 * Montar las cinco marcas como un tenant colapsaría todo en un solo número y no
 * habría nada que comparar — justo lo contrario de lo que se le quiere enseñar a
 * un director de división. Se monta Rosta sola, que sí se ve completa y honesta.
 *
 * El menú NO es inventado: sale de la carta pública de Rosta (rosta.mx,
 * mediterráneo-latino en Arboleda). Los precios son del rango de San Pedro; su
 * menú de 3 tiempos público está en $359.
 */
export const config: RestaurantSeed = {
  org: {
    id: 'rosta',
    display_name: 'ROSTA',
    city: 'San Pedro Garza García, NL',
    timezone: 'America/Monterrey',
    type: 'Mediterráneo · Latinoamericano',
    iva_rate: 16,
    address: 'Av. del Roble 660, Valle del Campestre, San Pedro Garza García, NL',
    receipt_footer: 'Gracias por acompañarnos.',
    plan: 'fullsite_software',
    data_source: 'fullsite',
    accent_color: 'amber',
  },

  location: {
    id: 'rosta-arboleda',
    name: 'Arboleda',
    address: 'Av. del Roble 660 CB01, Valle del Campestre, San Pedro Garza García, NL 66265',
    mesas: 18,
  },

  menu: [
    {
      id: 'ro-mezze', name: 'Para compartir', color: 'amber', sort_order: 1,
      items: [
        { id: 'ro-mez-hummus',   name: 'Hummus con pan pita',      price: 185, sort_order: 1 },
        { id: 'ro-mez-saganaki', name: 'Queso Saganaki flameado',  price: 235, sort_order: 2 },
        { id: 'ro-mez-baba',     name: 'Baba Ganoush',             price: 175, sort_order: 3 },
        { id: 'ro-mez-labneh',   name: 'Labneh con za\'atar',      price: 165, sort_order: 4 },
        { id: 'ro-mez-tabla',    name: 'Tabla de mezze',           price: 395, sort_order: 5 },
      ],
    },
    {
      id: 'ro-ensaladas', name: 'Ensaladas', color: 'green', sort_order: 2,
      items: [
        { id: 'ro-ens-fattoush', name: 'Fattoush',            price: 215, sort_order: 1 },
        { id: 'ro-ens-burrata',  name: 'Burrata con tomate',  price: 265, sort_order: 2 },
        { id: 'ro-ens-quinoa',   name: 'Quinoa mediterránea', price: 225, sort_order: 3 },
      ],
    },
    {
      id: 'ro-pizzas', name: 'Pizzas', color: 'red', sort_order: 3,
      items: [
        { id: 'ro-piz-burrata',   name: 'Pizza de Burrata',   price: 315, sort_order: 1 },
        { id: 'ro-piz-margarita', name: 'Margarita',          price: 265, sort_order: 2 },
        { id: 'ro-piz-pepperoni', name: 'Pepperoni',          price: 285, sort_order: 3 },
        { id: 'ro-piz-trufa',     name: 'Trufa y hongos',     price: 345, sort_order: 4 },
      ],
    },
    {
      id: 'ro-pastas', name: 'Pastas', color: 'yellow', sort_order: 4,
      items: [
        { id: 'ro-pas-gnocchi',  name: 'Gnocchi',             price: 295, sort_order: 1 },
        { id: 'ro-pas-rigatoni', name: 'Rigatoni al pomodoro', price: 275, sort_order: 2 },
        { id: 'ro-pas-linguine', name: 'Linguine con camarón', price: 355, sort_order: 3 },
      ],
    },
    {
      id: 'ro-fuertes', name: 'Fuertes', color: 'orange', sort_order: 5,
      items: [
        { id: 'ro-fue-pollo',   name: 'Pollo turco',        price: 325, sort_order: 1 },
        { id: 'ro-fue-salmon',  name: 'Salmón al za\'atar',  price: 425, sort_order: 2 },
        { id: 'ro-fue-cordero', name: 'Cordero braseado',    price: 465, sort_order: 3 },
        { id: 'ro-fue-ribeye',  name: 'Rib eye',             price: 545, sort_order: 4 },
      ],
    },
    {
      id: 'ro-desayunos', name: 'Desayunos', color: 'blue', sort_order: 6,
      items: [
        { id: 'ro-des-shakshuka', name: 'Shakshuka',              price: 215, sort_order: 1 },
        { id: 'ro-des-huevos',    name: 'Huevos con labneh',      price: 195, sort_order: 2 },
        { id: 'ro-des-hotcakes',  name: 'Hotcakes de pistache',   price: 205, sort_order: 3 },
      ],
    },
    {
      id: 'ro-postres', name: 'Postres', color: 'purple', sort_order: 7,
      items: [
        { id: 'ro-pos-baklava',  name: 'Baklava',              price: 145, sort_order: 1 },
        { id: 'ro-pos-basbousa', name: 'Basbousa',             price: 135, sort_order: 2 },
        { id: 'ro-pos-helado',   name: 'Helado de pistache',   price: 125, sort_order: 3 },
      ],
    },
    {
      id: 'ro-bebidas', name: 'Bebidas', color: 'cyan', sort_order: 8,
      items: [
        { id: 'ro-beb-limonada', name: 'Limonada de menta',  price: 95,  sort_order: 1 },
        { id: 'ro-beb-vino',     name: 'Copa de vino',       price: 185, sort_order: 2 },
        { id: 'ro-beb-cocktail', name: 'Cóctel de la casa',  price: 225, sort_order: 3 },
        { id: 'ro-beb-cafe',     name: 'Café turco',         price: 85,  sort_order: 4 },
      ],
    },
  ],

  // Personal de demostración. Los PIN son de demo, igual que en las otras
  // semillas del repo — este tenant no opera dinero real.
  staff: [
    { name: 'Daniel Olivares',  pin: '1234', role: 'admin'  },
    { name: 'Mariana Treviño',  pin: '2345', role: 'cajero' },
    { name: 'Sergio Cantú',     pin: '3456', role: 'mesero' },
    { name: 'Paulina Garza',    pin: '4567', role: 'mesero' },
  ],

  paymentMethods: [
    { name: 'Efectivo',      type: 'cash',     commission_pct: 0,   fiscal_code: '01' },
    { name: 'Tarjeta',       type: 'card',     commission_pct: 2.5, fiscal_code: '04' },
    { name: 'Transferencia', type: 'transfer', commission_pct: 0,   fiscal_code: '03' },
  ],

  // 90 días para que los agentes tengan tendencia que contar: un mes no alcanza
  // para hablar de estacionalidad ni de comparaciones mes contra mes, que es lo
  // que un director de división pregunta primero.
  historicalDays: 90,
}
