export const IDENTIDAD_CAMPOS = ['id', 'primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido', 'tipo_documento', 'num_documento', 'fecha_nacimiento']

export function normalizarDocumento(value) {
  if (!['string', 'number'].includes(typeof value)) return null
  const texto = String(value).trim().toUpperCase()
  const documento = /^[\d.\s]+$/.test(texto) ? texto.replace(/[.\s]/g, '') : texto
  return documento && documento.length <= 50 ? documento : null
}

export function fechaIdentidad(value) {
  if (value === null || value === undefined || value === '') return null
  const fecha = value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw errorIdentidad('Fecha de nacimiento no válida')
  const ms = Date.parse(fecha + 'T00:00:00Z')
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== fecha) throw errorIdentidad('Fecha de nacimiento no válida')
  return fecha
}

export function errorIdentidad(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

export function personaPublica(persona) {
  return {
    id: persona.id,
    nombre: [persona.primer_nombre, persona.segundo_nombre, persona.primer_apellido, persona.segundo_apellido].filter(Boolean).join(' '),
    primer_nombre: persona.primer_nombre,
    segundo_nombre: persona.segundo_nombre,
    primer_apellido: persona.primer_apellido,
    segundo_apellido: persona.segundo_apellido,
    tipo_documento: persona.tipo_documento,
    documento: persona.num_documento,
    fecha_nacimiento: fechaIdentidad(persona.fecha_nacimiento),
  }
}

export async function resolverIdentidad(trx, datos) {
  const documento = normalizarDocumento(datos.documento ?? datos.numero_documento ?? datos.num_documento)
  if (!documento) throw errorIdentidad('El documento es obligatorio y debe tener como máximo 50 caracteres')
  let persona = await trx('personas').select(IDENTIDAD_CAMPOS).where('num_documento', documento).first()
  let existente = Boolean(persona)
  if (!persona) {
    const nombres = Object.fromEntries(['primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido'].map(campo => {
      const value = datos[campo] ?? (campo === 'primer_nombre' ? datos.nombre : null)
      if (value != null && typeof value !== 'string') throw errorIdentidad('Los nombres deben ser texto')
      const nombre = value?.trim().replace(/\s+/g, ' ').toUpperCase() || null
      if (nombre && nombre.length > 100) throw errorIdentidad('Los nombres deben tener como máximo 100 caracteres')
      return [campo, nombre]
    }))
    if (!nombres.primer_nombre) throw errorIdentidad('El nombre es obligatorio para una persona nueva')
    const tipo = datos.tipo_documento || 'CC'
    if (!['CC', 'CE', 'PAS', 'NIT', 'OTRO'].includes(tipo)) throw errorIdentidad('Tipo de documento no válido')
    try {
      await trx('personas').insert({
        ...nombres, tipo_documento: tipo, num_documento: documento,
        fecha_nacimiento: fechaIdentidad(datos.fecha_nacimiento), es_independiente: false,
        status: 'activo',
      })
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err
      existente = true
    }
  }
  persona = await trx('personas').select(IDENTIDAD_CAMPOS).where('num_documento', documento).forUpdate().first()
  if (!persona) throw errorIdentidad('No se pudo resolver la identidad', 409)
  return { persona, existente }
}
