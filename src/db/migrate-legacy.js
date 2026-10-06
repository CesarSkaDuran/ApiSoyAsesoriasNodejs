import 'dotenv/config'
import knex from 'knex'
import db from './knex.js'

// ETL: soyaseso_bd (vieja, solo lectura) -> soyasesorias_db (nueva).
// Uso: npm run migrate-legacy
// Idempotente: se salta filas ya migradas via legacy_id / legacy_afiliacion_id.

const legacy = knex({
  client: 'mysql2',
  connection: {
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     Number(process.env.DB_PORT) || 3306,
    database: process.env.LEGACY_DB_NAME || 'soyaseso_bd',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  },
})

const stats = {}
function count(table, n = 1) { stats[table] = (stats[table] || 0) + n }

// ── Helpers de limpieza ──────────────────────────────────────────────────────

function parseFecha(v) {
  if (!v || typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s === '0000-00-00') return null
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // DD/MM/YYYY o DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const d = new Date(s)
  return isNaN(d) ? null : d.toISOString().slice(0, 10)
}

function num(v) {
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

function norm(v) {
  return (v || '').toString().trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Find-or-create en catalogo por nombre normalizado. Devuelve id o null.
async function catalogId(table, nombreRaw, cache) {
  const nombre = norm(nombreRaw)
  if (!nombre || nombre === 'NO TIENE' || nombre === 'NINGUNA' || nombre === '0') return null
  if (cache[table][nombre]) return cache[table][nombre]
  const found = await db(table).whereRaw('UPPER(nombre) = ?', [nombre]).first()
  if (found) { cache[table][nombre] = found.id; return found.id }
  const [id] = await db(table).insert({ nombre: nombreRaw.trim() })
  cache[table][nombre] = id
  count(`catalogo_${table}`)
  return id
}

const TIPO_DOC = { CC: 'CC', NIT: 'NIT', CE: 'CE', PAS: 'PAS', TI: 'OTRO' }
function tipoDoc(v, def = 'CC') {
  const s = norm(v)
  return TIPO_DOC[s] || def
}

const RIESGOS = ['I', 'II', 'III', 'IV', 'V']
function riesgo(v) {
  const s = norm(v).replace(/[^IVX0-9]/g, '')
  const map = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V' }
  return RIESGOS.includes(s) ? s : (map[s] || null)
}

// ── Migracion por entidad ────────────────────────────────────────────────────

async function migrateUsers() {
  const rows = await legacy('users').select('*')
  const map = {} // oldUserId -> newUserId

  for (const u of rows) {
    const exists = await db('users').where('email', u.email).first()
    if (exists) { map[u.id] = exists.id; continue }

    const role = (u.role_id === 1 || u.user_type === 5) ? 'admin' : 'empresa'
    const [id] = await db('users').insert({
      name: u.name || 'Sin nombre',
      lastname: u.lastname || null,
      email: u.email,
      password: u.password, // bcrypt $2a/$2y - compatible con bcryptjs
      role,
      is_active: u.status !== 0,
      created_at: u.created_at || new Date(),
      updated_at: u.updated_at || new Date(),
    })
    map[u.id] = id
    count('users')
  }
  return map
}

async function migrateModulos(userMap) {
  const rows = await legacy('modulos').select('*')
  const MODULOS = ['home','empresas','independientes','pagos','gastos','informes',
    'soportes','solicitudes','documentos','empleados','nominas','planillas','servicios']

  for (const m of rows) {
    const newUserId = userMap[m.user_id]
    if (!newUserId) continue
    const exists = await db('user_modulos').where('user_id', newUserId).first()
    if (exists) continue

    const data = { user_id: newUserId }
    for (const mod of MODULOS) data[mod] = m[mod] === 1
    await db('user_modulos').insert(data)
    count('user_modulos')
  }
}

async function migrateEmpresas(userMap, cache) {
  const rows = await legacy('empresas').select('*')
  const map = {} // oldAfiliacionId -> newEmpresaId (la llave del tenant viejo)

  for (const e of rows) {
    if (!e.afiliacion_id) continue
    const exists = await db('empresas').where('legacy_afiliacion_id', e.afiliacion_id).first()
    if (exists) { map[e.afiliacion_id] = exists.id; continue }

    const [id] = await db('empresas').insert({
      user_id: userMap[e.user_id] || null,
      legacy_id: e.id,
      legacy_afiliacion_id: e.afiliacion_id,
      razon_social: e.razon_social || e.primer_nombre || 'Sin nombre',
      tipo_documento: tipoDoc(e.tipoDocumento, 'NIT'),
      num_documento: e.numDocumento || null,
      dv: e.dv || null,
      tipo_empresa: e.tipoEmpresa === 1 ? 'natural' : 'juridica',
      direccion: e.direccion || null,
      telefono_fijo: e.telEmpresaFijo || null,
      telefono_movil: e.telEmpresaMovil || e.telefono || null,
      email: e.email || null,
      email_contacto: e.email_contacto || null,
      representante_legal: e.representanteLegal || e.nombre_responsable || null,
      nombre_contacto: e.nombre_contacto || e.contacto || null,
      telefono_contacto: e.telefono_contacto || e.telContacto || null,
      imagen: e.imagen || null,
      num_empleados: parseInt(e.numEmpleados) || null,
      riesgo: riesgo(e.riesgo),
      valor_empleado: e.valor_empleado || null,
      iva: e.iva || null,
      fecha_registro: parseFecha(e.fechaRegistro),
      status: e.status === 1 ? 'activo' : (e.activacion === 1 ? 'activo' : 'prospecto'),
      observaciones: e.obs || null,
      caja_compensacion_id: await catalogId('cajas_compensacion', e.caja_cf || e.cajaCompensacion, cache),
      created_at: e.created_at || new Date(),
      updated_at: e.updated_at || new Date(),
    })
    map[e.afiliacion_id] = id
    count('empresas')
  }
  return map
}

async function migratePersonas(userMap, afiliacionMap, cache) {
  const rows = await legacy('personas').select('*')

  for (const p of rows) {
    const exists = await db('personas').where('legacy_id', p.id).first()
    if (exists) continue

    await db('personas').insert({
      user_id: userMap[p.user_id] || null,
      legacy_id: p.id,
      legacy_afiliacion_id: p.afiliacion_id || null,
      primer_nombre: p.primer_nombre || 'Sin nombre',
      segundo_nombre: p.segundo_nombre || null,
      primer_apellido: p.primer_apellido || null,
      segundo_apellido: null,
      tipo_documento: tipoDoc(p.tipoDocumento),
      num_documento: p.numDocumento ? String(p.numDocumento) : null,
      direccion: p.direccion || null,
      telefono: p.telefono || null,
      email: p.email || null,
      imagen: p.imagen || null,
      status: p.status === 1 ? 'activo' : 'prospecto',
      observaciones: p.observaciones || null,
      es_independiente: true,
      created_at: p.created_at || new Date(),
      updated_at: p.updated_at || new Date(),
    })
    count('personas')
  }
}

async function migrateEmpleados(afiliacionMap, empresaIdMap, cache) {
  const rows = await legacy('empleados').select('*')
  const map = {} // oldEmpleadoId -> newEmpleadoId

  for (const e of rows) {
    const exists = await db('empleados').where('legacy_id', e.id).first()
    if (exists) { map[e.id] = exists.id; continue }

    // Resolver empresa: por id_afiliacion -> legacy_afiliacion_id, fallback id_empresa -> legacy_id
    let empresaId = afiliacionMap[e.id_afiliacion] || empresaIdMap[e.id_empresa]
    if (!empresaId) { count('empleados_sin_empresa'); continue }

    const row = {
      empresa_id: empresaId,
      legacy_id: e.id,
      primer_nombre: (e.primer_nombre || 'Sin nombre').slice(0, 100),
      segundo_nombre: (e.segundo_nombre || '').slice(0, 100) || null,
      primer_apellido: (e.primer_apellido || '').slice(0, 100) || null,
      segundo_apellido: (e.segundo_apellido || '').slice(0, 100) || null,
      tipo_documento: tipoDoc(e.tipo_documento),
      numero_documento: (e.numero_documento || `SIN-DOC-${e.id}`).slice(0, 50),
      direccion: e.direccion || null,
      movil: e.movil || null,
      email: e.email || null,
      fecha_ingreso: parseFecha(e.fecha_ingreso),
      fecha_retiro: parseFecha(e.fecha_retiro),
      salario_base: num(e.salario_base),
      subsidio_transporte: norm(e.subsidio_transporte) === 'SI' || e.subsidio_transporte === 1,
      riesgo: riesgo(e.riesgo),
      observaciones: e.observaciones || null,
      status: e.fecha_retiro ? 'retirado' : 'activo',
      eps_id: await catalogId('eps', e.eps, cache),
      arl_id: await catalogId('arl', e.arl, cache),
      pension_id: await catalogId('pensiones', e.f_de_pensiones, cache),
      caja_cf_id: await catalogId('cajas_compensacion', e.caja_cf, cache),
      cargo_id: await catalogId('cargos', e.cargo, cache),
      created_at: e.created_at || new Date(),
      updated_at: e.updated_at || new Date(),
    }

    try {
      const [id] = await db('empleados').insert(row)
      map[e.id] = id
      count('empleados')
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        // Duplicado real en la BD vieja: mismo documento 2 veces en la empresa
        const existing = await db('empleados')
          .where({ empresa_id: empresaId, numero_documento: row.numero_documento }).first()
        if (existing) map[e.id] = existing.id
        count('empleados_duplicados')
      } else {
        throw err
      }
    }
  }
  return map
}

async function migrateNominas(afiliacionMap, empresaIdMap, empleadoMap) {
  const rows = await legacy('nomina').select('*')
  const nominaMap = {}

  for (const n of rows) {
    const empresaId = afiliacionMap[n.afiliacion_id] || empresaIdMap[n.empresa_id]
    if (!empresaId) { count('nominas_sin_empresa'); continue }

    const exists = await db('nominas').where({ empresa_id: empresaId, nombre_periodo: n.nombre_periodo }).first()
    if (exists) { nominaMap[n.id] = exists.id; continue }

    const [id] = await db('nominas').insert({
      empresa_id: empresaId,
      nombre_periodo: (n.nombre_periodo || '').slice(0, 100) || null,
      num_empleados: Math.round(num(n.numEmpleado)),
      valor_total: num(n.valorTotal),
      total_seguridad_social: num(n.t_valorSS),
      total_horas_extras: num(n.t_valorHorasEx),
      total_otros_pagos: num(n.t_otrosPagos),
      total_deducciones: num(n.t_deducciones),
      status: 'liquidada',
      created_at: n.created_at || new Date(),
      updated_at: n.updated_at || new Date(),
    })
    nominaMap[n.id] = id
    count('nominas')
  }

  // detalle_nomina -> nomina_detalles
  const detalles = await legacy('detalle_nomina').select('*')
  for (const d of detalles) {
    const nominaId = nominaMap[d.nomina_id]
    const empleadoId = empleadoMap[d.empleado_id]
    if (!nominaId || !empleadoId) { count('detalles_sin_referencia'); continue }

    const exists = await db('nomina_detalles').where({ nomina_id: nominaId, empleado_id: empleadoId }).first()
    if (exists) continue

    await db('nomina_detalles').insert({
      nomina_id: nominaId,
      empleado_id: empleadoId,
      dias_laborados: num(d.dias_laborados),
      salario_base: num(d.salario_base),
      aux_transporte: num(d.aux_transporte),
      horas_extras: num(d.horas_extras),
      otros_ingresos: num(d.otros_ingresos),
      ingreso_noc: num(d.ingreso_noc),
      deducciones: num(d.deducciones),
      ibc: num(d.ibc),
      ibl: d.ibl,
      salud: num(d.salud),
      pension: num(d.pension),
      arl: num(d.arl),
      ccf: num(d.ccf),
      sena: num(d.sena),
      icbf: num(d.icdf),
      riesgo: num(d.riesgo),
      cesantias: num(d.cesantias),
      intereses: num(d.intereses),
      vacaciones: num(d.vacaciones),
      indemnizacion: num(d.indemnizacion),
      total_nomina: num(d.totalNomina),
      total_planilla: num(d.totalPlanilla),
      neto: num(d.totalNomina),
      created_at: d.created_at || new Date(),
      updated_at: d.updated_at || new Date(),
    })
    count('nomina_detalles')
  }
}

async function migrateDocumentos(afiliacionMap, empleadoMap) {
  const rows = await legacy('multimedias').select('*')
  for (const m of rows) {
    const exists = await db('documentos').where('nombre', m.name).where('path', m.url).first()
    if (exists) continue

    const data = {
      uploaded_by: null,
      nombre: m.name || 'documento',
      descripcion: m.description || null,
      // La url vieja queda como referencia; el archivo fisico se copia aparte si existe
      path: m.url,
      mime: null,
      size: null,
      created_at: m.created_at || new Date(),
      updated_at: m.updated_at || new Date(),
    }

    if (m.empleado_id && empleadoMap[m.empleado_id]) {
      data.empleado_id = empleadoMap[m.empleado_id]
    } else if (m.afiliacion_id && afiliacionMap[m.afiliacion_id]) {
      data.empresa_id = afiliacionMap[m.afiliacion_id]
    } else if (m.planilla_id) {
      // planillas viejas -> pendiente de migrar esa tabla; se guarda empresa si se puede
      count('documentos_sin_owner')
      continue
    } else {
      count('documentos_sin_owner')
      continue
    }

    await db('documentos').insert(data)
    count('documentos')
  }
}

// Mapa afiliacion vieja -> {empresa_id, persona_id} para resolver owners
async function afiliacionOwnerMap() {
  const rows = await db('afiliaciones').select('legacy_id', 'empresa_id', 'persona_id')
  return Object.fromEntries(rows.filter(r => r.legacy_id).map(r => [r.legacy_id, r]))
}

// servicios viejos -> nuevos por nombre normalizado
async function servicioIdMap(cache) {
  const rows = await legacy('servicios').select('id', 'nombre')
  const map = {}
  for (const s of rows) map[s.id] = await catalogId('servicios', s.nombre, cache)
  return map
}

async function migrateServicioRegistros(afiliacionMap, empleadoMap, servicioMap, ownerMap, sucursalMap = {}) {
  const rows = await legacy('detalle_servicios').select('*')
  const personaRows = await db('personas').select('id', 'legacy_afiliacion_id')
  const personaByAfi = Object.fromEntries(personaRows.filter(p => p.legacy_afiliacion_id).map(p => [p.legacy_afiliacion_id, p.id]))

  for (const s of rows) {
    const sucursalId = s.sucursal_id ? sucursalMap[s.sucursal_id] || null : null
    const exists = await db('servicio_registros').where('legacy_id', s.id).first()
    if (exists) {
      if (sucursalId && !exists.sucursal_id) {
        await db('servicio_registros').where('id', exists.id).update({ sucursal_id: sucursalId })
        count('servicio_registros_sucursal_backfill')
      }
      continue
    }

    const owner = s.id_afiliacion ? ownerMap[s.id_afiliacion] : null
    const data = {
      empresa_id: owner?.empresa_id || afiliacionMap[s.id_afiliacion] || null,
      persona_id: owner?.persona_id || personaByAfi[s.id_afiliacion] || null,
      empleado_id: empleadoMap[s.empleado_id] || null,
      servicio_id: servicioMap[s.id_servicio] || null,
      sucursal_id: sucursalId,
      nombre: s.nombre || null,
      tipo: s.tipo ?? null,
      fecha: parseFecha(s.date) || parseFecha(s.created_at),
      cantidad: s.cantidad ?? 1,
      valor: num(s.valor) || null,
      paquete: s.paquete || null,
      unidad: s.unidad || null,
      numero_empleados: Math.round(num(s.numero_empleados)),
      obs: s.obs || null,
      status: s.status ?? 1,
      status_pago: s.status_pago ?? 2,
      legacy_id: s.id,
      created_at: s.created_at || new Date(),
      updated_at: s.updated_at || new Date(),
    }
    if (!data.empresa_id && !data.persona_id) { count('servicio_registros_sin_owner'); continue }
    await db('servicio_registros').insert(data)
    count('servicio_registros')
  }
}

// Sucursales: old sucursales.id_empresa -> old empresas.id -> empresaIdMap.
// id_empresa=0 eran las sedes propias de Soy Asesorias (CUCUTA/OCANA) -> empresa_id NULL.
async function migrateSucursales(empresaIdMap) {
  const rows = await legacy('sucursales').select('*')
  const map = {}
  for (const s of rows) {
    const exists = await db('sucursales').where('legacy_id', s.id).first()
    if (exists) { map[s.id] = exists.id; continue }
    const empresaId = empresaIdMap[s.id_empresa] || null
    const [id] = await db('sucursales').insert({
      empresa_id: empresaId,
      nombre: s.nombre || 'Sucursal',
      legacy_id: s.id,
      created_at: s.created_at || new Date(),
      updated_at: s.updated_at || new Date(),
    })
    map[s.id] = id
    count(empresaId ? 'sucursales' : 'sucursales_internas')
  }
  return map
}

async function migrateTerceros(empresaIdMap) {
  const rows = await legacy('terceros').select('*')
  const map = {}
  for (const t of rows) {
    const exists = await db('terceros').where('legacy_id', t.id).first()
    if (exists) { map[t.id] = exists.id; continue }
    const nombre = [t.nombre, t.apellido].filter(Boolean).join(' ').trim() || 'Sin nombre'
    const [id] = await db('terceros').insert({
      empresa_id: empresaIdMap[t.empresa_id] || null,
      nombre,
      num_documento: t.documento ? String(t.documento) + (t.dv ? `-${t.dv}` : '') : null,
      tipo: t.tipo_terceros || null,
      email: t.email || null,
      telefono: t.telefono ? String(t.telefono) : null,
      legacy_id: t.id,
      created_at: t.created_at || new Date(),
      updated_at: t.updated_at || new Date(),
    })
    map[t.id] = id
    count('terceros')
  }
  return map
}

async function migrateListaGastos(empresaIdMap) {
  // La tabla vieja tiene ids NULL — dedup por nombre
  const rows = await legacy('lista_gastos').select('*')
  const map = {}
  for (const l of rows) {
    const nombre = (l.nombre || 'Gasto').trim()
    const exists = await db('lista_gastos').whereRaw('LOWER(nombre) = ?', [nombre.toLowerCase()]).first()
    if (exists) { map[nombre] = exists.id; continue }
    const [id] = await db('lista_gastos').insert({
      empresa_id: empresaIdMap[l.empresa_id] || null,
      nombre,
      created_at: l.created_at || new Date(),
      updated_at: l.updated_at || new Date(),
    })
    map[nombre] = id
    count('lista_gastos')
  }
  return map
}

async function migrateGastos(empresaIdMap, terceroMap, listaMap, sucursalMap) {
  const rows = await legacy('gastos').select('*')
  for (const g of rows) {
    const exists = await db('gastos').where('legacy_id', g.id).first()
    if (exists) continue
    await db('gastos').insert({
      lista_gasto_id: null,
      empresa_id: empresaIdMap[g.id_empresa] || null,
      tercero_id: g.tercero_id ? terceroMap[g.tercero_id] || null : null,
      sucursal_id: g.sucursal_id ? sucursalMap[g.sucursal_id] || null : null,
      nombre: g.nombre || null,
      descripcion: g.obs || null,
      banco: g.banco || null,
      meses: g.meses || null,
      valor: num(g.valor),
      iva: num(g.iva),
      fecha: parseFecha(g.fecha) || parseFecha(g.created_at),
      status: g.status ?? 2,
      legacy_id: g.id,
      created_at: g.created_at || new Date(),
      updated_at: g.updated_at || new Date(),
    })
    count('gastos')
  }
}

async function migrateCuentasCobro(afiliacionMap, empresaIdMap, ownerMap, sucursalMap = {}, terceroMap = {}) {
  const rows = await legacy('cuenta_cobro').select('*')
  const personaRows = await db('personas').select('id', 'legacy_afiliacion_id')
  const personaByAfi = Object.fromEntries(personaRows.filter(p => p.legacy_afiliacion_id).map(p => [p.legacy_afiliacion_id, p.id]))

  for (const c of rows) {
    const sucursalId = c.sucursal_id ? sucursalMap[c.sucursal_id] || null : null
    const terceroId = c.tercero_id ? terceroMap[c.tercero_id] || null : null
    const exists = await db('cuentas_cobro').where('legacy_id', c.id).first()
    if (exists) {
      // Backfill: asignar sucursal/tercero/tipo a filas ya migradas
      const patch = {}
      if (sucursalId && !exists.sucursal_id) patch.sucursal_id = sucursalId
      if (terceroId && !exists.tercero_id) patch.tercero_id = terceroId
      if (exists.tipo == null && c.tipo != null) patch.tipo = c.tipo
      if (!exists.banco && c.banco) patch.banco = c.banco
      if (!exists.meses && c.meses) patch.meses = c.meses
      if (Object.keys(patch).length) {
        await db('cuentas_cobro').where('id', exists.id).update(patch)
        count('cuentas_cobro_backfill')
      }
      continue
    }

    const owner = c.id_afiliacion ? ownerMap[c.id_afiliacion] : null
    const data = {
      empresa_id: owner?.empresa_id || afiliacionMap[c.id_afiliacion] || empresaIdMap[c.id_empresa] || null,
      persona_id: owner?.persona_id || personaByAfi[c.id_afiliacion] || null,
      tercero_id: terceroId,
      sucursal_id: sucursalId,
      numero: String(c.id),
      tipo: c.tipo ?? 1,
      nombre: c.nombre || null,
      banco: c.banco || null,
      meses: c.meses || null,
      fecha: parseFecha(c.fecha) || parseFecha(c.created_at),
      valor_total: num(c.valor) + num(c.iva) + num(c.cuatroxmil),
      iva: num(c.iva),
      cuatroxmil: num(c.cuatroxmil),
      obs: c.obs || null,
      status: c.status ?? 2,
      legacy_id: c.id,
      created_at: c.created_at || new Date(),
      updated_at: c.updated_at || new Date(),
    }
    if (!data.empresa_id && !data.persona_id && !data.tercero_id) { count('cuentas_cobro_sin_owner'); continue }
    await db('cuentas_cobro').insert(data)
    count('cuentas_cobro')
  }
}

async function migrateSoportes(userMap) {
  const rows = await legacy('soporte').select('*')
  for (const s of rows) {
    const exists = await db('soportes').where('legacy_id', s.id).first()
    if (exists) continue
    await db('soportes').insert({
      user_id: userMap[s.user_id] || null,
      asunto: s.tipo_servicio || 'Solicitud de soporte',
      mensaje: s.descripcion || null,
      tipo_solicitud: s.tipo_solicitud || null,
      tipo_servicio: s.tipo_servicio || null,
      nombre: s.nombre || null,
      email: s.email || null,
      telefono: s.telefono ? String(s.telefono) : null,
      status: s.status ?? 1,
      legacy_id: s.id,
      created_at: s.created_at || new Date(),
      updated_at: s.updated_at || new Date(),
    })
    count('soportes')
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Migrando datos de soyaseso_bd -> soyasesorias_db...\n')

  const cache = { eps: {}, arl: {}, pensiones: {}, cajas_compensacion: {}, cargos: {}, servicios: {} }

  const userMap = await migrateUsers()
  await migrateModulos(userMap)

  // Mapa adicional: old empresas.id -> new empresa.id
  const afiliacionMap = await migrateEmpresas(userMap, cache)
  const empresaRows = await db('empresas').select('id', 'legacy_id')
  const empresaIdMap = Object.fromEntries(empresaRows.map(e => [e.legacy_id, e.id]))

  await migratePersonas(userMap, afiliacionMap, cache)
  const empleadoMap = await migrateEmpleados(afiliacionMap, empresaIdMap, cache)
  await migrateNominas(afiliacionMap, empresaIdMap, empleadoMap)
  await migrateDocumentos(afiliacionMap, empleadoMap)

  // Servicios prestados, cuentas de cobro, terceros, gastos y tickets de soporte
  const ownerMap = await afiliacionOwnerMap()
  const servicioMap = await servicioIdMap(cache)
  const sucursalMap = await migrateSucursales(empresaIdMap)
  const terceroMap = await migrateTerceros(empresaIdMap)
  const listaGastoMap = await migrateListaGastos(empresaIdMap)
  await migrateServicioRegistros(afiliacionMap, empleadoMap, servicioMap, ownerMap, sucursalMap)
  await migrateCuentasCobro(afiliacionMap, empresaIdMap, ownerMap, sucursalMap, terceroMap)
  await migrateGastos(empresaIdMap, terceroMap, listaGastoMap, sucursalMap)
  await migrateSoportes(userMap)

  console.log('\nResumen de migracion:')
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`)
  console.log('\nListo.')
}

try {
  await main()
} catch (err) {
  console.error('Error en migracion:', err)
  process.exitCode = 1
} finally {
  await legacy.destroy()
  await db.destroy()
}
