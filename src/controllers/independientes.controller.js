import db from '../db/knex.js'
import { esStaff } from '../middlewares/auth.js'
import { normalizarDocumento, personaPublica } from '../services/personas-identidad.js'

// Trabajadores independientes (personas). Admin ve todos; el independiente
// solo su propio registro (via req.user.persona_id).

// GET /personas/buscar?documento=XXX — búsqueda ciega de identidad.
// Solo expone cédula, nombre y fecha de nacimiento: nunca empresa,
// historial, documentos ni observaciones. Sirve para que admin/empresa
// detecten si una cédula ya tiene identidad global al contratar.
export async function buscar(req, res) {
  if (!['admin', 'empresa'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Sin acceso' })
  }
  const documento = normalizarDocumento(req.query.documento)
  if (!documento) return res.status(400).json({ error: 'documento requerido' })
  const persona = await db('personas')
    .select('id', 'primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido', 'num_documento', 'fecha_nacimiento')
    .where('num_documento', documento)
    .first()
  if (!persona) return res.json({ existe: false })
  res.json({ existe: true, persona: personaPublica(persona) })
}

const CAMPOS = [
  'primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido',
  'tipo_documento', 'num_documento', 'direccion', 'telefono', 'email',
  'departamento_id', 'ciudad_id', 'tipo_afiliacion', 'observaciones', 'status',
]

// GET /personas?search=&status=&page=&per_page=  (admin)
// GET /personas?empresa_id= no aplica - personas son independientes
export async function list(req, res) {
  const { search, status, desde, hasta, page = 1, per_page = 25 } = req.query

  const query = db('personas')
    .leftJoin('users', 'personas.user_id', 'users.id')
    .leftJoin('departamentos', 'personas.departamento_id', 'departamentos.id')
    .leftJoin('ciudades', 'personas.ciudad_id', 'ciudades.id')
    .select('personas.*', 'users.email as user_email',
      'departamentos.nombre as departamento_nombre', 'ciudades.nombre as ciudad_nombre')

  if (req.user.role === 'independiente') {
    query.where('personas.id', req.user.persona_id || -1)
  } else if (!esStaff(req.user)) {
    query.whereRaw('1=0')
  }

  if (search) {
    query.where(q =>
      q.where('personas.primer_nombre', 'like', `%${search}%`)
       .orWhere('personas.primer_apellido', 'like', `%${search}%`)
       .orWhere('personas.num_documento', 'like', `%${search}%`)
       .orWhere('personas.email', 'like', `%${search}%`)
    )
  }
  if (status) query.where('personas.status', status)
  if (desde) query.where('personas.created_at', '>=', `${desde} 00:00:00`)
  if (hasta) query.where('personas.created_at', '<=', `${hasta} 23:59:59`)

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('personas.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// GET /personas/:id
export async function show(req, res) {
  const persona = await db('personas').where('id', req.params.id).first()
  if (!persona) return res.status(404).json({ error: 'Persona no encontrada' })
  if (req.user.role === 'independiente' && persona.id !== req.user.persona_id) {
    return res.status(403).json({ error: 'Sin acceso' })
  }
  if (req.user.role === 'empresa') return res.status(403).json({ error: 'Sin acceso' })

  const [documentos, servicios, cuentas] = await Promise.all([
    db('documentos').where('persona_id', persona.id).orderBy('id', 'desc'),
    db('servicio_registros').where('persona_id', persona.id).orderBy('id', 'desc'),
    db('cuentas_cobro').where('persona_id', persona.id).orderBy('id', 'desc'),
  ])
  res.json({ persona, documentos, servicios, cuentas })
}

// POST /personas - admin registra independiente
export async function create(req, res) {
  const data = { tipo_afiliacion: 'independiente', es_independiente: true }
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (!data.primer_nombre) return res.status(400).json({ error: 'primer_nombre es requerido' })

  const [id] = await db('personas').insert(data)
  const persona = await db('personas').where('id', id).first()
  res.status(201).json({ persona })
}

// PUT /personas/:id - admin, o el propio independiente (campos limitados)
export async function update(req, res) {
  const persona = await db('personas').where('id', req.params.id).first()
  if (!persona) return res.status(404).json({ error: 'Persona no encontrada' })
  if (req.user.role === 'independiente' && persona.id !== req.user.persona_id) {
    return res.status(403).json({ error: 'Sin acceso' })
  }
  if (req.user.role === 'empresa') return res.status(403).json({ error: 'Sin acceso' })

  const permitidos = esStaff(req.user)
    ? CAMPOS
    : ['direccion', 'telefono', 'email', 'departamento_id', 'ciudad_id']
  const data = {}
  for (const campo of permitidos) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  await db('personas').where('id', persona.id).update(data)
  res.json({ persona: await db('personas').where('id', persona.id).first() })
}
