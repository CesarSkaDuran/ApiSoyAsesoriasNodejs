import db from '../db/knex.js'
import { canAccessEmpresa, esStaff } from '../middlewares/auth.js'

const CAMPOS = [
  'razon_social', 'tipo_documento', 'num_documento', 'dv', 'tipo_empresa',
  'direccion', 'telefono_fijo', 'telefono_movil', 'email', 'email_contacto',
  'representante_legal', 'nombre_contacto', 'telefono_contacto',
  'email_responsable', 'telefono_responsable',
  'imagen', 'num_empleados', 'riesgo', 'valor_empleado', 'iva', 'fecha_registro',
  'status', 'observaciones', 'actividad_economica_id', 'departamento_id',
  'ciudad_id', 'caja_compensacion_id', 'exonerado_parafiscales',
  'arl_id', 'eps_id', 'factor_prestacional_pct',
]

// CST art. 132: el factor prestacional no puede ser menor al 30% legal.
// Rango superior razonable 100%.
function validarFactor(res, factor) {
  const f = Number(factor)
  if (!(f >= 30 && f <= 100)) {
    res.status(400).json({
      error: `El factor prestacional no puede ser menor al 30% ni mayor al 100% (CST art. 132). Recibido: ${factor}%`,
    })
    return false
  }
  return true
}

// GET /empresas - admin: todas (con search/paginacion). empresa: solo la suya.
export async function list(req, res) {
  const { search, status, desde, hasta, page = 1, per_page = 20 } = req.query

  const query = db('empresas')
    .leftJoin('users', 'empresas.user_id', 'users.id')
    .select('empresas.*', 'users.email as user_email',
      db.raw(`(SELECT COUNT(*) FROM empleados e WHERE e.empresa_id = empresas.id) as num_empleados`))

  if (req.user.role === 'empresa') {
    query.where('empresas.id', req.user.empresa_id)
  } else if (!esStaff(req.user)) {
    // independiente u otros roles no ven el directorio de empresas
    query.whereRaw('1=0')
  }
  if (search) {
    query.where(q =>
      q.where('empresas.razon_social', 'like', `%${search}%`)
       .orWhere('empresas.num_documento', 'like', `%${search}%`)
    )
  }
  if (status) query.where('empresas.status', status)
  if (desde) query.whereRaw('COALESCE(empresas.fecha_registro, DATE(empresas.created_at)) >= ?', [desde])
  if (hasta) query.whereRaw('COALESCE(empresas.fecha_registro, DATE(empresas.created_at)) <= ?', [hasta])

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('empresas.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// GET /empresas/:id
export async function show(req, res) {
  const { id } = req.params
  if (!canAccessEmpresa(req.user, id)) {
    return res.status(403).json({ error: 'Sin acceso a esta empresa' })
  }

  const empresa = await db('empresas').where('id', id).first()
  if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' })

  const [servicios, sucursales, totales] = await Promise.all([
    db('empresa_servicios')
      .join('servicios', 'empresa_servicios.servicio_id', 'servicios.id')
      .select('empresa_servicios.*', 'servicios.nombre as servicio_nombre', 'servicios.tipo')
      .where('empresa_servicios.empresa_id', id),
    db('sucursales').where('empresa_id', id),
    db('empleados').where('empresa_id', id).count('* as empleados').first(),
  ])

  res.json({ empresa, servicios, sucursales, total_empleados: totales.empleados })
}

// POST /empresas - solo admin
export async function create(req, res) {
  const data = {}
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (!data.razon_social) {
    return res.status(400).json({ error: 'razon_social es requerida' })
  }
  if (data.factor_prestacional_pct !== undefined && !validarFactor(res, data.factor_prestacional_pct)) return

  const [id] = await db('empresas').insert(data)
  const empresa = await db('empresas').where('id', id).first()
  res.status(201).json({ empresa })
}

// PUT /empresas/:id - admin edita todo; empresa solo datos de contacto
export async function update(req, res) {
  const { id } = req.params
  if (!canAccessEmpresa(req.user, id)) {
    return res.status(403).json({ error: 'Sin acceso a esta empresa' })
  }

  const permitidos = esStaff(req.user)
    ? CAMPOS
    : ['direccion', 'telefono_movil', 'email_contacto', 'nombre_contacto', 'telefono_contacto', 'imagen']

  const data = {}
  for (const campo of permitidos) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Nada que actualizar' })
  }

  // Cambio de factor prestacional: valida rango legal y, si sube el piso,
  // verifica que no invalide empleados con salario integral existentes.
  if (data.factor_prestacional_pct !== undefined) {
    if (!validarFactor(res, data.factor_prestacional_pct)) return
    const actual = await db('empresas').where('id', id).first()
    const factorNuevo = Number(data.factor_prestacional_pct)
    if (Number(actual.factor_prestacional_pct) !== factorNuevo) {
      const p = await db('nomina_parametros').orderBy('vigencia', 'desc').first()
      const smmlv = Number(p?.salario_minimo) || 0
      const pisoNuevo = smmlv * 10 * (1 + factorNuevo / 100)
      const invalidos = await db('empleados')
        .where('empresa_id', id)
        .whereIn('salario_integral', [1, true])
        .where('salario_base', '<', pisoNuevo)
        .select('id', 'primer_nombre', 'primer_apellido', 'salario_base')
      if (invalidos.length && req.body.forzar_cambio_factor !== true && req.body.forzar_cambio_factor !== 'true') {
        const salarios = invalidos.map(e => Number(e.salario_base))
        return res.status(409).json({
          error: `Cambiar el factor a ${factorNuevo}% invalida ${invalidos.length} empleado(s) integrales con salario entre $${Math.min(...salarios).toLocaleString('es-CO')} y $${Math.max(...salarios).toLocaleString('es-CO')}. ¿Confirmas el cambio?`,
          empleados_invalidos: invalidos.map(e => ({
            id: e.id,
            nombre: [e.primer_nombre, e.primer_apellido].filter(Boolean).join(' ').trim(),
            salario: Number(e.salario_base),
          })),
          requiere: 'forzar_cambio_factor=true',
        })
      }
      if (invalidos.length) {
        console.warn(`[empresas] factor_prestacional ${factorNuevo}% forzado en empresa ${id}: ${invalidos.length} integrales quedan bajo el piso`)
      }
    }
  }

  await db('empresas').where('id', id).update(data)
  const empresa = await db('empresas').where('id', id).first()
  res.json({ empresa })
}

// POST /empresas/:id/servicios - admin asigna un servicio/plan a la empresa
export async function addServicio(req, res) {
  const { id } = req.params
  const { servicio_id, valor, fecha_inicio } = req.body

  if (!servicio_id) return res.status(400).json({ error: 'servicio_id requerido' })

  const exists = await db('empresa_servicios').where({ empresa_id: id, servicio_id }).first()
  if (exists) {
    await db('empresa_servicios')
      .where({ empresa_id: id, servicio_id })
      .update({ valor, fecha_inicio, status: 'activo' })
  } else {
    await db('empresa_servicios').insert({
      empresa_id: id, servicio_id, valor, fecha_inicio, status: 'activo',
    })
  }

  const servicios = await db('empresa_servicios')
    .join('servicios', 'empresa_servicios.servicio_id', 'servicios.id')
    .select('empresa_servicios.*', 'servicios.nombre as servicio_nombre')
    .where('empresa_servicios.empresa_id', id)

  res.json({ servicios })
}

// DELETE /empresas/:id/servicios/:servicioId - admin quita un servicio asignado
export async function removeServicio(req, res) {
  const { id, servicioId } = req.params
  await db('empresa_servicios')
    .where({ empresa_id: id, servicio_id: servicioId })
    .delete()

  const servicios = await db('empresa_servicios')
    .join('servicios', 'empresa_servicios.servicio_id', 'servicios.id')
    .select('empresa_servicios.*', 'servicios.nombre as servicio_nombre')
    .where('empresa_servicios.empresa_id', id)

  res.json({ servicios })
}
