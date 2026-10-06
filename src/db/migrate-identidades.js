import { normalizarDocumento, resolverIdentidad } from '../services/personas-identidad.js'

export async function migrateIdentidades(db) {
  const personas = await db('personas').select('id', 'num_documento')
  const empleados = await db('empleados').select('*')
  const empresas = new Set((await db('empresas').select('id')).map(e => e.id))
  const documentos = new Map()
  for (const persona of personas) {
    const documento = normalizarDocumento(persona.num_documento)
    if (!documento) continue
    if (documentos.has(documento)) throw new Error(`Identidades duplicadas: personas ${documentos.get(documento)} y ${persona.id}. Resolver antes de migrar; no se borraron registros.`)
    documentos.set(documento, persona.id)
  }
  const activos = new Set()
  for (const empleado of empleados) {
    const documento = normalizarDocumento(empleado.numero_documento)
    if (!documento || !empresas.has(empleado.empresa_id)) throw new Error(`Empleado ${empleado.id} sin documento válido o empresa existente. Corregir antes de migrar.`)
    const clave = empleado.empresa_id + ':' + documento
    if (empleado.status === 'activo' && activos.has(clave)) throw new Error(`Duplicado activo en empresa ${empleado.empresa_id}, empleado ${empleado.id}. Resolver antes de migrar.`)
    if (empleado.status === 'activo') activos.add(clave)
  }
  for (const tabla of ['personas', 'empresas', 'empleados']) {
    const [status] = await db.raw('SHOW TABLE STATUS WHERE Name = ?', [tabla])
    if (status[0]?.Engine !== 'InnoDB') await db.raw('ALTER TABLE ?? ENGINE=InnoDB', [tabla])
  }
  if (!await db.schema.hasColumn('personas', 'fecha_nacimiento')) {
    await db.schema.alterTable('personas', t => { t.date('fecha_nacimiento').nullable() })
  }
  if (!await db.schema.hasColumn('personas', 'es_independiente')) {
    await db.schema.alterTable('personas', t => { t.boolean('es_independiente').notNullable().defaultTo(true).index() })
  }
  await db.transaction(async trx => {
    for (const persona of personas) {
      const documento = normalizarDocumento(persona.num_documento)
      if (documento !== persona.num_documento) await trx('personas').where('id', persona.id).update({ num_documento: documento })
    }
  })
  const [indicesPersona] = await db.raw('SHOW INDEX FROM personas')
  const indices = new Map()
  for (const indice of indicesPersona) {
    if (!indice.Non_unique) indices.set(indice.Key_name, [...(indices.get(indice.Key_name) || []), indice.Column_name])
  }
  if (![...indices.values()].some(cols => cols.length === 1 && cols[0] === 'num_documento')) {
    await db.schema.alterTable('personas', t => { t.unique('num_documento', 'personas_documento_unique') })
  }
  if (!await db.schema.hasColumn('empleados', 'persona_id')) {
    await db.schema.alterTable('empleados', t => { t.integer('persona_id').unsigned().nullable().index() })
  }
  await db.transaction(async trx => {
    for (const empleado of empleados) {
      let persona
      try {
        ;({ persona } = await resolverIdentidad(trx, empleado))
      } catch (err) {
        throw new Error(`Empleado ${empleado.id} (${empleado.numero_documento}): ${err.message}`)
      }
      if (empleado.persona_id && empleado.persona_id !== persona.id) throw new Error(`Empleado ${empleado.id} vinculado a una identidad incompatible. Revisar antes de migrar.`)
      if (!empleado.persona_id) await trx('empleados').where('id', empleado.id).update({ persona_id: persona.id })
    }
  })
  const [columnas] = await db.raw("SHOW COLUMNS FROM empleados LIKE 'persona_id'")
  if (columnas[0]?.Null === 'YES') await db.raw('ALTER TABLE empleados MODIFY persona_id INT UNSIGNED NOT NULL')
  if (!await db.schema.hasColumn('empleados', 'empresa_activa_id')) {
    await db.raw("ALTER TABLE empleados ADD empresa_activa_id INT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'activo' THEN empresa_id ELSE NULL END) STORED")
  }
  const [indicesEmpleado] = await db.raw('SHOW INDEX FROM empleados')
  if (!indicesEmpleado.some(i => i.Key_name === 'empleados_persona_empresa_activa_unique')) {
    await db.schema.alterTable('empleados', t => { t.unique(['persona_id', 'empresa_activa_id'], 'empleados_persona_empresa_activa_unique') })
  }
  const antiguos = new Map()
  for (const indice of indicesEmpleado) {
    if (!indice.Non_unique && indice.Key_name !== 'PRIMARY') antiguos.set(indice.Key_name, [...(antiguos.get(indice.Key_name) || []), indice.Column_name])
  }
  for (const [nombre, cols] of antiguos) {
    if (cols.length === 2 && cols.includes('empresa_id') && cols.includes('numero_documento')) await db.raw('ALTER TABLE empleados DROP INDEX ??', [nombre])
  }
  await db.transaction(async trx => {
    for (const empleado of empleados) {
      const documento = normalizarDocumento(empleado.numero_documento)
      if (documento !== empleado.numero_documento) await trx('empleados').where('id', empleado.id).update({ numero_documento: documento })
    }
  })
  for (const [columna, tabla] of [['persona_id', 'personas'], ['empresa_id', 'empresas']]) {
    const [foreignKeys] = await db.raw('SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?', ['empleados', columna, tabla])
    if (!foreignKeys.length) {
      await db.schema.alterTable('empleados', t => { t.foreign(columna, 'empleados_' + columna + '_fk').references('id').inTable(tabla).onDelete('RESTRICT') })
    }
  }
}
