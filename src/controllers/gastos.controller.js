import db from '../db/knex.js'

// Gastos administrativos (solo admin los gestiona y ve).
// GET /gastos?search=&page=&per_page=
export async function list(req, res) {
  const { search, status, sucursal_id, desde, hasta, page = 1, per_page = 25 } = req.query

  const query = db('gastos')
    .leftJoin('lista_gastos', 'gastos.lista_gasto_id', 'lista_gastos.id')
    .leftJoin('empresas', 'gastos.empresa_id', 'empresas.id')
    .leftJoin('terceros', 'gastos.tercero_id', 'terceros.id')
    .leftJoin('sucursales', 'gastos.sucursal_id', 'sucursales.id')
    .select('gastos.*', 'lista_gastos.nombre as tipo_nombre',
      'empresas.razon_social as empresa_nombre', 'empresas.num_documento as empresa_nit',
      'terceros.nombre as tercero_nombre', 'terceros.num_documento as tercero_nit',
      'sucursales.nombre as sucursal_nombre',
      db.raw(`COALESCE(terceros.nombre, empresas.razon_social, gastos.nombre) as proveedor_nombre`),
      db.raw(`COALESCE(terceros.num_documento, empresas.num_documento) as proveedor_nit`))

  if (search) {
    query.where(q =>
      q.where('gastos.descripcion', 'like', `%${search}%`)
       .orWhere('gastos.nombre', 'like', `%${search}%`)
       .orWhere('empresas.razon_social', 'like', `%${search}%`)
       .orWhere('terceros.nombre', 'like', `%${search}%`)
       .orWhere('terceros.num_documento', 'like', `%${search}%`)
    )
  }
  if (status) query.where('gastos.status', status)
  if (sucursal_id) query.where('gastos.sucursal_id', sucursal_id)
  if (desde) query.where('gastos.fecha', '>=', desde)
  if (hasta) query.where('gastos.fecha', '<=', hasta)

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('gastos.fecha', 'desc')
    .orderBy('gastos.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// POST /gastos
export async function create(req, res) {
  const { lista_gasto_id, empresa_id, tercero_id, sucursal_id, nombre, descripcion,
          valor, iva, banco, meses, fecha } = req.body
  if (!valor) return res.status(400).json({ error: 'valor requerido' })

  const [id] = await db('gastos').insert({
    lista_gasto_id: lista_gasto_id || null,
    empresa_id: empresa_id || null,
    tercero_id: tercero_id || null,
    sucursal_id: sucursal_id || null,
    nombre: nombre || null,
    descripcion: descripcion || null,
    banco: banco || null,
    meses: meses || null,
    valor,
    iva: iva || 0,
    fecha: fecha || new Date(),
    status: 2,
  })
  const gasto = await db('gastos').where('id', id).first()
  res.status(201).json({ gasto })
}

// PUT /gastos/:id
export async function update(req, res) {
  const gasto = await db('gastos').where('id', req.params.id).first()
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' })

  const CAMPOS = ['lista_gasto_id', 'empresa_id', 'tercero_id', 'sucursal_id', 'nombre',
    'descripcion', 'valor', 'iva', 'banco', 'meses', 'fecha', 'status']
  const data = {}
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  await db('gastos').where('id', gasto.id).update(data)
  res.json({ gasto: await db('gastos').where('id', gasto.id).first() })
}

// DELETE /gastos/:id
export async function remove(req, res) {
  const gasto = await db('gastos').where('id', req.params.id).first()
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' })
  await db('gastos').where('id', gasto.id).delete()
  res.json({ message: 'Gasto eliminado' })
}
