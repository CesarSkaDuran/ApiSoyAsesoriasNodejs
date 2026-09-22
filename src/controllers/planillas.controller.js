import db from '../db/knex.js'
import { canAccessEmpresa } from '../middlewares/auth.js'

// Planillas PILA de seguridad social.
// GET /planillas?empresa_id=&periodo=&status=&page=&per_page=
export async function list(req, res) {
  const { periodo, status, page = 1, per_page = 25 } = req.query
  const empresaId = req.user.role === 'admin' ? req.query.empresa_id : req.user.empresa_id

  const query = db('planillas')
    .leftJoin('empresas', 'planillas.empresa_id', 'empresas.id')
    .leftJoin('nominas', 'planillas.nomina_id', 'nominas.id')
    .select('planillas.*', 'empresas.razon_social as empresa_nombre', 'nominas.nombre_periodo',
      'nominas.num_empleados', 'nominas.total_otros_pagos',
      db.raw(`(SELECT COALESCE(SUM(nd.salario_base * nd.dias_laborados / 30), 0)
        FROM nomina_detalles nd WHERE nd.nomina_id = nominas.id) as salario_dias`))

  if (req.user.role !== 'admin') {
    query.where('planillas.empresa_id', req.user.empresa_id || -1)
  } else if (empresaId) {
    query.where('planillas.empresa_id', empresaId)
  }
  if (periodo) query.where('planillas.periodo', periodo)
  if (status) query.where('planillas.status', status)

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('planillas.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// GET /planillas/:id
export async function show(req, res) {
  const planilla = await db('planillas').where('id', req.params.id).first()
  if (!planilla) return res.status(404).json({ error: 'Planilla no encontrada' })
  if (!canAccessEmpresa(req.user, planilla.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso' })
  }
  const documentos = await db('documentos').where('planilla_id', planilla.id)
  res.json({ planilla, documentos })
}

// POST /planillas - admin registra planilla generada/pagada
export async function create(req, res) {
  const { empresa_id, nomina_id, numero_planilla, periodo, valor_total, fecha_pago } = req.body
  if (!empresa_id) return res.status(400).json({ error: 'empresa_id requerido' })

  const [id] = await db('planillas').insert({
    empresa_id,
    nomina_id: nomina_id || null,
    numero_planilla: numero_planilla || null,
    periodo: periodo || null,
    valor_total: valor_total ?? 0,
    fecha_pago: fecha_pago || null,
    status: 'generada',
  })
  const planilla = await db('planillas').where('id', id).first()
  res.status(201).json({ planilla })
}

// PUT /planillas/:id - admin actualiza estado (pagada/verificada)
export async function update(req, res) {
  const planilla = await db('planillas').where('id', req.params.id).first()
  if (!planilla) return res.status(404).json({ error: 'Planilla no encontrada' })

  const CAMPOS = ['numero_planilla', 'periodo', 'valor_total', 'fecha_pago', 'status', 'nomina_id']
  const data = {}
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  await db('planillas').where('id', planilla.id).update(data)
  res.json({ planilla: await db('planillas').where('id', planilla.id).first() })
}
