import db from '../db/knex.js'
import { canAccessEmpresa, esStaff } from '../middlewares/auth.js'
import { createReadStream, unlinkSync } from 'fs'
import { IMAGE_MIMES, rutaStorage } from '../services/branding.js'

const CAMPOS = [
  'razon_social', 'tipo_documento', 'num_documento', 'dv', 'tipo_empresa',
  'direccion', 'telefono_fijo', 'telefono_movil', 'email', 'email_contacto',
  'representante_legal', 'nombre_contacto', 'telefono_contacto',
  'email_responsable', 'telefono_responsable',
  'imagen', 'num_empleados', 'riesgo', 'valor_empleado', 'iva', 'fecha_registro',
  'status', 'observaciones', 'actividad_economica_id', 'departamento_id',
  'ciudad_id', 'caja_compensacion_id', 'exonerado_parafiscales',
  'arl_id', 'eps_id', 'factor_prestacional_pct', 'pila_modalidad',
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

  const [servicios, sucursales, centros_trabajo, arl, totales] = await Promise.all([
    db('empresa_servicios')
      .join('servicios', 'empresa_servicios.servicio_id', 'servicios.id')
      .select('empresa_servicios.*', 'servicios.nombre as servicio_nombre', 'servicios.tipo')
      .where('empresa_servicios.empresa_id', id),
    db('sucursales')
      .leftJoin('ciudades as sc', 'sucursales.ciudad_id', 'sc.id')
      .select('sucursales.*', 'sc.nombre as ciudad_nombre')
      .where('sucursales.empresa_id', id)
      .orderBy([{ column: 'activo', order: 'desc' }, { column: 'nombre' }]),
    db('centros_trabajo').where('empresa_id', id).orderBy([{ column: 'activo', order: 'desc' }, { column: 'nombre' }]),
    empresa.arl_id ? db('arl').where('id', empresa.arl_id).first('nombre') : null,
    db('empleados').where('empresa_id', id).count('* as empleados').first(),
  ])

  res.json({
    empresa: { ...empresa, arl_nombre: arl?.nombre ?? null },
    servicios,
    sucursales,
    centros_trabajo,
    total_empleados: totales.empleados,
  })
}

const PILA_MODALIDADES = new Set(['consolidada', 'por_sucursal'])

function validarCodigoSucursal(codigo) {
  if (codigo === null || codigo === undefined || codigo === '') return true
  return /^\d{5}$/.test(String(codigo).trim())
}

// La sucursal es una sede/obra de la misma empresa, no una entidad legal aparte.
export async function listSucursales(req, res) {
  const empresa = await empresaVisible(req, res)
  if (!empresa) return
  const query = db('sucursales')
    .leftJoin('ciudades as c', 'sucursales.ciudad_id', 'c.id')
    .where('sucursales.empresa_id', empresa.id)
  if (req.query.activas === '1') query.where('activo', true)
  res.json({
    data: await query
      .select('sucursales.*', 'c.nombre as ciudad_nombre')
      .orderBy([{ column: 'sucursales.activo', order: 'desc' }, { column: 'sucursales.nombre' }]),
  })
}

export async function createSucursal(req, res) {
  const empresa = await empresaVisible(req, res)
  if (!empresa) return
  const nombre = String(req.body.nombre || '').trim()
  const direccion = String(req.body.direccion || '').trim() || null
  const codigoPila = String(req.body.codigo_pila || '').trim() || null
  const ciudadId = req.body.ciudad_id ? Number(req.body.ciudad_id) : null
  if (!nombre || nombre.length > 150) {
    return res.status(400).json({ error: 'El nombre de la sucursal/obra debe tener entre 1 y 150 caracteres' })
  }
  if (empresa.pila_modalidad === 'por_sucursal' && !codigoPila) {
    return res.status(400).json({ error: 'Esta empresa separa la PILA por sucursal; ingresa el código PILA de 5 dígitos' })
  }
  if (!validarCodigoSucursal(codigoPila)) {
    return res.status(400).json({ error: 'El código PILA de sucursal debe tener 5 dígitos' })
  }
  if (ciudadId && !await db('ciudades').where('id', ciudadId).first('id')) {
    return res.status(400).json({ error: 'La ciudad seleccionada no existe' })
  }
  if (await db('sucursales')
    .where('empresa_id', empresa.id)
    .whereRaw('LOWER(nombre) = LOWER(?)', [nombre])
    .first('id')) {
    return res.status(409).json({ error: 'Ya existe una sucursal/obra con ese nombre en la empresa' })
  }
  const [id] = await db('sucursales').insert({
    empresa_id: empresa.id,
    nombre,
    direccion,
    ciudad_id: ciudadId,
    codigo_pila: codigoPila,
    activo: true,
  })
  res.status(201).json({ sucursal: await db('sucursales').where('id', id).first() })
}

export async function updateSucursal(req, res) {
  const empresa = await empresaVisible(req, res)
  if (!empresa) return
  const sucursal = await db('sucursales')
    .where({ id: req.params.sucursalId, empresa_id: empresa.id })
    .first()
  if (!sucursal) return res.status(404).json({ error: 'Sucursal/obra no encontrada en esta empresa' })

  const data = {}
  if (req.body.nombre !== undefined) {
    data.nombre = String(req.body.nombre || '').trim()
    if (!data.nombre || data.nombre.length > 150) {
      return res.status(400).json({ error: 'El nombre de la sucursal/obra debe tener entre 1 y 150 caracteres' })
    }
  }
  if (req.body.direccion !== undefined) data.direccion = String(req.body.direccion || '').trim() || null
  if (req.body.ciudad_id !== undefined) {
    data.ciudad_id = req.body.ciudad_id ? Number(req.body.ciudad_id) : null
    if (data.ciudad_id && !await db('ciudades').where('id', data.ciudad_id).first('id')) {
      return res.status(400).json({ error: 'La ciudad seleccionada no existe' })
    }
  }
  if (req.body.codigo_pila !== undefined) {
    data.codigo_pila = String(req.body.codigo_pila || '').trim() || null
    if (!validarCodigoSucursal(data.codigo_pila)) {
      return res.status(400).json({ error: 'El código PILA de sucursal debe tener 5 dígitos' })
    }
  }
  if (req.body.activo !== undefined) {
    data.activo = ['1', 'true', 'on'].includes(String(req.body.activo))
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nada que actualizar' })
  const quedaraActiva = data.activo ?? Boolean(sucursal.activo)
  const codigoResultante = data.codigo_pila !== undefined ? data.codigo_pila : sucursal.codigo_pila
  if (empresa.pila_modalidad === 'por_sucursal' && quedaraActiva && !codigoResultante) {
    return res.status(400).json({ error: 'Esta sucursal requiere un código PILA de 5 dígitos para estar activa' })
  }
  if (data.nombre !== undefined && await db('sucursales')
    .where('empresa_id', empresa.id)
    .whereNot('id', sucursal.id)
    .whereRaw('LOWER(nombre) = LOWER(?)', [data.nombre])
    .first('id')) {
    return res.status(409).json({ error: 'Ya existe una sucursal/obra con ese nombre en la empresa' })
  }
  if (data.activo === false) {
    const [asignados] = await db('empleados')
      .where({ empresa_id: empresa.id, sucursal_id: sucursal.id, status: 'activo' })
      .count('id as total')
    if (Number(asignados.total)) {
      return res.status(409).json({
        error: `No se puede desactivar: hay ${Number(asignados.total)} empleado(s) activo(s) asignado(s) a esta sucursal`,
        empleados_asignados: Number(asignados.total),
      })
    }
  }
  await db('sucursales').where('id', sucursal.id).update(data)
  res.json({ sucursal: await db('sucursales').where('id', sucursal.id).first() })
}

const RIESGOS_CENTRO = new Set(['I', 'II', 'III', 'IV', 'V'])

async function empresaVisible(req, res) {
  const empresa = await db('empresas').where('id', req.params.id).first('id', 'pila_modalidad')
  if (!empresa) {
    res.status(404).json({ error: 'Empresa no encontrada' })
    return null
  }
  if (!canAccessEmpresa(req.user, empresa.id)) {
    res.status(403).json({ error: 'Sin acceso a esta empresa' })
    return null
  }
  return empresa
}

// GET /empresas/:id/centros-trabajo
export async function listCentrosTrabajo(req, res) {
  const empresa = await empresaVisible(req, res)
  if (!empresa) return
  const query = db('centros_trabajo').where('empresa_id', empresa.id)
  if (req.query.activos === '1') query.where('activo', true)
  res.json({ data: await query.orderBy([{ column: 'activo', order: 'desc' }, { column: 'nombre' }]) })
}

// POST /empresas/:id/centros-trabajo
export async function createCentroTrabajo(req, res) {
  const empresa = await empresaVisible(req, res)
  if (!empresa) return
  const nombre = String(req.body.nombre || '').trim()
  const riesgo = String(req.body.riesgo || '').toUpperCase()
  if (!nombre || nombre.length > 150) {
    return res.status(400).json({ error: 'El nombre del centro debe tener entre 1 y 150 caracteres' })
  }
  if (!RIESGOS_CENTRO.has(riesgo)) {
    return res.status(400).json({ error: 'Selecciona una clase de riesgo válida (I a V)' })
  }
  if (await db('centros_trabajo')
    .where('empresa_id', empresa.id)
    .whereRaw('LOWER(nombre) = LOWER(?)', [nombre])
    .first('id')) {
    return res.status(409).json({ error: 'Ya existe un centro de trabajo con ese nombre en la empresa' })
  }
  const [id] = await db('centros_trabajo').insert({
    empresa_id: empresa.id,
    nombre,
    riesgo,
    activo: true,
  })
  res.status(201).json({ centro_trabajo: await db('centros_trabajo').where('id', id).first() })
}

// PUT /empresas/:id/centros-trabajo/:centroId
export async function updateCentroTrabajo(req, res) {
  const empresa = await empresaVisible(req, res)
  if (!empresa) return
  const centro = await db('centros_trabajo')
    .where({ id: req.params.centroId, empresa_id: empresa.id })
    .first()
  if (!centro) return res.status(404).json({ error: 'Centro de trabajo no encontrado' })

  const data = {}
  if (req.body.nombre !== undefined) {
    data.nombre = String(req.body.nombre).trim()
    if (!data.nombre || data.nombre.length > 150) {
      return res.status(400).json({ error: 'El nombre del centro debe tener entre 1 y 150 caracteres' })
    }
  }
  if (req.body.riesgo !== undefined) {
    data.riesgo = String(req.body.riesgo).toUpperCase()
    if (!RIESGOS_CENTRO.has(data.riesgo)) {
      return res.status(400).json({ error: 'Selecciona una clase de riesgo válida (I a V)' })
    }
  }
  if (req.body.activo !== undefined) {
    data.activo = ['1', 'true', 'on'].includes(String(req.body.activo))
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nada que actualizar' })

  if (data.nombre !== undefined && await db('centros_trabajo')
    .where('empresa_id', empresa.id)
    .whereNot('id', centro.id)
    .whereRaw('LOWER(nombre) = LOWER(?)', [data.nombre])
    .first('id')) {
    return res.status(409).json({ error: 'Ya existe un centro de trabajo con ese nombre en la empresa' })
  }
  await db.transaction(async trx => {
    await trx('centros_trabajo').where('id', centro.id).update(data)
    if (data.riesgo !== undefined && data.riesgo !== centro.riesgo) {
      await trx('empleados').where('centro_trabajo_id', centro.id).update({ riesgo: data.riesgo })
    }
  })
  res.json({ centro_trabajo: await db('centros_trabajo').where('id', centro.id).first() })
}

// DELETE /empresas/:id/centros-trabajo/:centroId — se conserva el vínculo histórico.
export async function deactivateCentroTrabajo(req, res) {
  const empresa = await empresaVisible(req, res)
  if (!empresa) return
  const centro = await db('centros_trabajo')
    .where({ id: req.params.centroId, empresa_id: empresa.id })
    .first('id')
  if (!centro) return res.status(404).json({ error: 'Centro de trabajo no encontrado' })
  await db('centros_trabajo').where('id', centro.id).update({ activo: false })
  res.json({ message: 'Centro de trabajo desactivado' })
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
  if (data.pila_modalidad && !PILA_MODALIDADES.has(data.pila_modalidad)) {
    return res.status(400).json({ error: 'pila_modalidad debe ser consolidada o por_sucursal' })
  }
  if (data.factor_prestacional_pct !== undefined && !validarFactor(res, data.factor_prestacional_pct)) return

  const [id] = await db('empresas').insert(data)
  const empresa = await db('empresas').where('id', id).first()
  res.status(201).json({ empresa })
}

// Logo y firma de la empresa para sus documentos de RR. HH. Admin/asesor y la
// empresa dueña pueden cambiarlos; solo se aceptan imágenes PNG o JPG.
const descartarArchivos = (req) => Object.values(req.files || {}).flat().forEach(f => unlinkSync(f.path))

// PUT /empresas/:id/branding (multipart: logo, firma, firma_nombre, firma_cargo)
export async function updateBranding(req, res) {
  const empresa = await db('empresas').where('id', req.params.id).first()
  if (!empresa) {
    descartarArchivos(req)
    return res.status(404).json({ error: 'Empresa no encontrada' })
  }
  if (!canAccessEmpresa(req.user, empresa.id)) {
    descartarArchivos(req)
    return res.status(403).json({ error: 'Sin acceso a esta empresa' })
  }
  const logo = req.files?.logo?.[0]
  const firma = req.files?.firma?.[0]
  if ([logo, firma].some(f => f && !IMAGE_MIMES.includes(f.mimetype))) {
    descartarArchivos(req)
    return res.status(400).json({ error: 'El logo y la firma deben ser imágenes PNG o JPG' })
  }

  const data = {}
  if (logo) Object.assign(data, { logo_path: logo.filename, logo_mime: logo.mimetype })
  if (firma) Object.assign(data, { firma_path: firma.filename, firma_mime: firma.mimetype })
  if (req.body.firma_nombre !== undefined) data.firma_nombre = String(req.body.firma_nombre).trim().slice(0, 160) || null
  if (req.body.firma_cargo !== undefined) data.firma_cargo = String(req.body.firma_cargo).trim().slice(0, 160) || null
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nada que actualizar' })

  await db('empresas').where('id', empresa.id).update(data)
  // Reemplazo: el archivo anterior se borra después de guardar el nuevo
  for (const [nuevo, anterior] of [[data.logo_path, empresa.logo_path], [data.firma_path, empresa.firma_path]]) {
    const ruta = nuevo && anterior && anterior !== nuevo ? rutaStorage(anterior) : null
    if (ruta) unlinkSync(ruta)
  }
  res.json({ ok: true })
}

// GET /empresas/:id/branding/:tipo — logo o firma (autenticado)
export async function getBrandingFile(req, res) {
  const empresa = await db('empresas').where('id', req.params.id).first()
  if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' })
  if (!canAccessEmpresa(req.user, empresa.id)) return res.status(403).json({ error: 'Sin acceso a esta empresa' })
  const tipo = req.params.tipo === 'firma' ? 'firma' : 'logo'
  const ruta = rutaStorage(empresa[`${tipo}_path`])
  if (!ruta) return res.status(404).json({ error: 'No hay imagen cargada' })
  res.setHeader('Content-Type', empresa[`${tipo}_mime`] || 'image/png')
  createReadStream(ruta).pipe(res)
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
  if (data.pila_modalidad !== undefined) {
    if (!PILA_MODALIDADES.has(data.pila_modalidad)) {
      return res.status(400).json({ error: 'pila_modalidad debe ser consolidada o por_sucursal' })
    }
    if (data.pila_modalidad === 'por_sucursal') {
      const sinCodigo = await db('sucursales')
        .where('empresa_id', id)
        .where('activo', true)
        .where(q => q.whereNull('codigo_pila').orWhere('codigo_pila', ''))
        .count('id as total')
        .first()
      if (Number(sinCodigo.total)) {
        return res.status(409).json({
          error: 'Completa el código PILA de 5 dígitos en todas las sucursales activas antes de separar planillas',
          sucursales_sin_codigo_pila: Number(sinCodigo.total),
        })
      }
    }
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
