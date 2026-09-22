import db from '../db/knex.js'

// GET /catalogos - todos los catalogos en una sola llamada (para formularios)
export async function all(req, res) {
  const [departamentos, ciudades, eps, arl, pensiones, cajas, bancos, cargos, servicios, actividades,
    listaGastos, terceros, sucursales] =
    await Promise.all([
      db('departamentos').orderBy('nombre'),
      db('ciudades').orderBy('nombre'),
      db('eps').where('activo', true).orderBy('nombre'),
      db('arl').where('activo', true).orderBy('nombre'),
      db('pensiones').where('activo', true).orderBy('nombre'),
      db('cajas_compensacion').where('activo', true).orderBy('nombre'),
      db('bancos').where('activo', true).orderBy('nombre'),
      db('cargos').orderBy('nombre'),
      db('servicios').where('activo', true).orderBy('id'),
      db('actividades_economicas').orderBy('nombre'),
      db('lista_gastos').orderBy('nombre'),
      db('terceros').orderBy('nombre').limit(500),
      db('sucursales').orderBy('nombre'),
    ])

  res.json({
    departamentos, ciudades, eps, arl, pensiones,
    cajas_compensacion: cajas, bancos, cargos, servicios,
    actividades_economicas: actividades,
    lista_gastos: listaGastos, terceros, sucursales,
  })
}
