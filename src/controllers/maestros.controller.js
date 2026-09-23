import db from '../db/knex.js'

// ════════════════════════════════════════════════════════════════════════════
// Maestros parametrizables: cada entrada define la tabla, los campos editables
// del formulario y los joins para mostrar nombres en la tabla.
// El frontend genera los formularios y columnas dinamicamente desde esta config.
// ════════════════════════════════════════════════════════════════════════════

const txt = (key, label, opts = {}) => ({ key, label, type: 'text', ...opts })
const num = (key, label, opts = {}) => ({ key, label, type: 'number', ...opts })
const sel = (key, label, source, opts = {}) => ({ key, label, type: 'select', source, ...opts })
const staticSel = (key, label, options, opts = {}) => ({ key, label, type: 'select', options, ...opts })
const bool = (key, label, opts = {}) => ({ key, label, type: 'boolean', default: true, ...opts })
const area = (key, label, opts = {}) => ({ key, label, type: 'textarea', ...opts })

// usadoEn: como la BD no tiene FKs fisicas, el delete verifica en aplicacion
// que el registro no este referenciado por otras tablas.
const MAESTROS = {
  departamentos: {
    label: 'Departamentos', icon: 'map',
    singular: 'departamento',
    fields: [txt('nombre', 'Nombre', { required: true })],
    usadoEn: [
      { table: 'ciudades', col: 'departamento_id', label: 'ciudades' },
      { table: 'empresas', col: 'departamento_id', label: 'empresas' },
      { table: 'personas', col: 'departamento_id', label: 'independientes' },
    ],
  },
  ciudades: {
    label: 'Ciudades', icon: 'map-pin',
    singular: 'ciudad',
    fields: [
      txt('nombre', 'Nombre', { required: true }),
      sel('departamento_id', 'Departamento', 'departamentos', { required: true }),
    ],
    joins: [{ fk: 'departamento_id', table: 'departamentos', alias: 'departamento_nombre' }],
    usadoEn: [
      { table: 'empresas', col: 'ciudad_id', label: 'empresas' },
      { table: 'personas', col: 'ciudad_id', label: 'independientes' },
      { table: 'empleados', col: 'ciudad_id', label: 'empleados' },
      { table: 'sucursales', col: 'ciudad_id', label: 'sucursales' },
    ],
  },
  eps: {
    label: 'EPS', icon: 'heart-pulse',
    singular: 'EPS',
    fields: [txt('nombre', 'Nombre', { required: true }), bool('activo', 'Activo')],
    usadoEn: [{ table: 'empleados', col: 'eps_id', label: 'empleados' }],
  },
  arl: {
    label: 'ARL', icon: 'shield-check',
    singular: 'ARL',
    fields: [txt('nombre', 'Nombre', { required: true }), bool('activo', 'Activo')],
    usadoEn: [{ table: 'empleados', col: 'arl_id', label: 'empleados' }],
  },
  pensiones: {
    label: 'Fondos de pensión', icon: 'piggy-bank',
    singular: 'fondo de pensión',
    fields: [txt('nombre', 'Nombre', { required: true }), bool('activo', 'Activo')],
    usadoEn: [{ table: 'empleados', col: 'pension_id', label: 'empleados' }],
  },
  cajas_compensacion: {
    label: 'Cajas de compensación', icon: 'hand-coins',
    singular: 'caja de compensación',
    fields: [txt('nombre', 'Nombre', { required: true }), bool('activo', 'Activo')],
    usadoEn: [
      { table: 'empleados', col: 'caja_cf_id', label: 'empleados' },
      { table: 'empresas', col: 'caja_compensacion_id', label: 'empresas' },
    ],
  },
  bancos: {
    label: 'Bancos', icon: 'landmark',
    singular: 'banco',
    fields: [txt('nombre', 'Nombre', { required: true }), bool('activo', 'Activo')],
  },
  cargos: {
    label: 'Cargos', icon: 'briefcase',
    singular: 'cargo',
    fields: [txt('nombre', 'Nombre', { required: true })],
    usadoEn: [{ table: 'empleados', col: 'cargo_id', label: 'empleados' }],
  },
  actividades_economicas: {
    label: 'Actividades económicas', icon: 'factory',
    singular: 'actividad económica',
    fields: [
      txt('codigo', 'Código'),
      txt('nombre', 'Nombre', { required: true }),
    ],
    usadoEn: [{ table: 'empresas', col: 'actividad_economica_id', label: 'empresas' }],
  },
  servicios: {
    label: 'Servicios / Planes', icon: 'handshake',
    singular: 'servicio',
    fields: [
      txt('nombre', 'Nombre', { required: true }),
      area('descripcion', 'Descripción'),
      staticSel('tipo', 'Tipo', [
        { value: 'servicio', label: 'Servicio' },
        { value: 'plan', label: 'Plan' },
      ], { default: 'servicio' }),
      num('valor', 'Valor'),
      bool('activo', 'Activo'),
    ],
    usadoEn: [
      { table: 'empresa_servicios', col: 'servicio_id', label: 'empresas' },
      { table: 'servicio_registros', col: 'servicio_id', label: 'registros de servicio' },
      { table: 'afiliaciones', col: 'servicio_id', label: 'afiliaciones' },
    ],
  },
  lista_gastos: {
    label: 'Tipos de gasto', icon: 'receipt',
    singular: 'tipo de gasto',
    fields: [txt('nombre', 'Nombre', { required: true })],
    usadoEn: [{ table: 'gastos', col: 'lista_gasto_id', label: 'gastos' }],
  },
  sucursales: {
    label: 'Sucursales', icon: 'store',
    singular: 'sucursal',
    fields: [
      txt('nombre', 'Nombre', { required: true }),
      sel('empresa_id', 'Empresa', 'empresas', { required: true }),
      txt('direccion', 'Dirección'),
      sel('ciudad_id', 'Ciudad', 'ciudades'),
    ],
    joins: [
      { fk: 'empresa_id', table: 'empresas', col: 'razon_social', alias: 'empresa_nombre' },
      { fk: 'ciudad_id', table: 'ciudades', alias: 'ciudad_nombre' },
    ],
    usadoEn: [
      { table: 'empleados', col: 'sucursal_id', label: 'empleados' },
      { table: 'cuentas_cobro', col: 'sucursal_id', label: 'cuentas de cobro' },
      { table: 'gastos', col: 'sucursal_id', label: 'gastos' },
      { table: 'servicio_registros', col: 'sucursal_id', label: 'registros de servicio' },
    ],
  },
  terceros: {
    label: 'Terceros / Proveedores', icon: 'truck',
    singular: 'tercero',
    fields: [
      txt('nombre', 'Nombre', { required: true }),
      txt('num_documento', 'Nit/Cc'),
      staticSel('tipo', 'Tipo', [
        { value: 'Proveedor', label: 'Proveedor' },
        { value: 'Cliente', label: 'Cliente' },
        { value: 'Otro', label: 'Otro' },
      ]),
      txt('email', 'Email'),
      txt('telefono', 'Teléfono'),
      sel('empresa_id', 'Empresa (opcional)', 'empresas'),
    ],
    joins: [{ fk: 'empresa_id', table: 'empresas', col: 'razon_social', alias: 'empresa_nombre' }],
    usadoEn: [
      { table: 'cuentas_cobro', col: 'tercero_id', label: 'cuentas de cobro' },
      { table: 'gastos', col: 'tercero_id', label: 'gastos' },
    ],
  },
}

// Campos que nunca se aceptan del body (proteccion de columnas internas)
const PROTEGIDOS = ['id', 'legacy_id', 'created_at', 'updated_at']

function cfg(req, res) {
  const c = MAESTROS[req.params.catalogo]
  if (!c) {
    res.status(404).json({ message: 'Maestro no existe' })
    return null
  }
  return c
}

function pickFields(c, body) {
  const out = {}
  for (const f of c.fields) {
    if (PROTEGIDOS.includes(f.key)) continue
    let v = body[f.key]
    if (v === '' || v === undefined) v = null
    if (f.type === 'boolean' && v === null) v = f.default ?? true
    if (f.type === 'number' && v !== null) v = Number(v)
    if (f.type === 'select' && v !== null) v = Number(v)
    out[f.key] = v
  }
  return out
}

function validateRequired(c, data) {
  for (const f of c.fields) {
    if (f.required && (data[f.key] === null || data[f.key] === ''))
      return `El campo "${f.label}" es obligatorio`
  }
  return null
}

// GET /maestros — metadata de todos los catalogos (para armar el menu dinamico)
export async function index(req, res) {
  const counts = await Promise.all(
    Object.keys(MAESTROS).map(k => db(MAESTROS[k].tabla || k).count('id as n').first())
  )
  const items = Object.entries(MAESTROS).map(([key, c], i) => ({
    key, label: c.label, icon: c.icon, fields: c.fields,
    singular: c.singular || c.label.toLowerCase(),
    total: Number(counts[i].n),
  }))
  res.json(items)
}

// GET /maestros/:catalogo — filas con joins para mostrar nombres
export async function list(req, res) {
  const c = cfg(req, res); if (!c) return
  const table = c.tabla || req.params.catalogo
  const page = Math.max(1, Number(req.query.page) || 1)
  const per = Math.min(200, Math.max(1, Number(req.query.per_page) || 25))
  const search = (req.query.search || '').trim()

  const q = db(table + ' as t').select('t.*')
  for (const j of c.joins || []) {
    q.leftJoin(`${j.table} as j_${j.fk}`, `j_${j.fk}.id`, `t.${j.fk}`)
      .select(db.raw(`j_${j.fk}.${j.col || 'nombre'} as ${j.alias}`))
  }
  if (search) {
    q.where(b => {
      b.where('t.nombre', 'like', `%${search}%`)
      if (table === 'actividades_economicas') b.orWhere('t.codigo', 'like', `%${search}%`)
      if (table === 'terceros') b.orWhere('t.num_documento', 'like', `%${search}%`)
    })
  }

  const [{ n }] = await q.clone().clearSelect().count('t.id as n')
  const data = await q.orderBy('t.nombre').limit(per).offset((page - 1) * per)
  res.json({ data, total: Number(n), page, per_page: per })
}

// POST /maestros/:catalogo
export async function create(req, res) {
  const c = cfg(req, res); if (!c) return
  const data = pickFields(c, req.body)
  const err = validateRequired(c, data)
  if (err) return res.status(400).json({ message: err })
  try {
    const [id] = await db(c.tabla || req.params.catalogo).insert(data)
    res.status(201).json({ id, ...data })
  } catch (e) {
    res.status(400).json({ message: 'No se pudo crear: ' + (e.sqlMessage || e.message) })
  }
}

// PUT /maestros/:catalogo/:id
export async function update(req, res) {
  const c = cfg(req, res); if (!c) return
  const data = pickFields(c, req.body)
  const err = validateRequired(c, data)
  if (err) return res.status(400).json({ message: err })
  try {
    const n = await db(c.tabla || req.params.catalogo).where('id', req.params.id).update(data)
    if (!n) return res.status(404).json({ message: 'Registro no encontrado' })
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ message: 'No se pudo actualizar: ' + (e.sqlMessage || e.message) })
  }
}

// DELETE /maestros/:catalogo/:id — verifica uso en aplicacion (no hay FKs fisicas)
export async function remove(req, res) {
  const c = cfg(req, res); if (!c) return
  const id = req.params.id
  try {
    // Verificar referencias antes de borrar
    const usos = []
    for (const u of c.usadoEn || []) {
      const [{ n }] = await db(u.table).where(u.col, id).count('id as n')
      if (Number(n) > 0) usos.push(`${n} en ${u.label}`)
    }
    if (usos.length)
      return res.status(409).json({ message: `No se puede eliminar: está en uso (${usos.join(', ')})` })

    const n = await db(c.tabla || req.params.catalogo).where('id', id).del()
    if (!n) return res.status(404).json({ message: 'Registro no encontrado' })
    res.json({ ok: true })
  } catch (e) {
    if (e.errno === 1451 || e.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({ message: 'No se puede eliminar: el registro está en uso por otros módulos' })
    res.status(400).json({ message: 'No se pudo eliminar: ' + (e.sqlMessage || e.message) })
  }
}
