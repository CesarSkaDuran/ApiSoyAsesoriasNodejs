// Calendario de festivos de Colombia (días no laborables nacionales).
// Combina los festivos de fecha fija, los trasladados al lunes siguiente
// por la Ley 51 de 1983 (Ley Emiliani) y los que dependen del domingo de
// Pascua (computus gregoriano). Las fechas se manejan en UTC para evitar
// corrimientos por zona horaria.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const pad = n => String(n).padStart(2, '0')
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

const utc = (anio, mes, dia) => new Date(Date.UTC(anio, mes - 1, dia))
const plusDias = (fecha, dias) => {
  const d = new Date(fecha.getTime())
  d.setUTCDate(d.getUTCDate() + dias)
  return d
}
// Traslado Emiliani: si no cae lunes, corre al lunes siguiente.
const alLunes = fecha => plusDias(fecha, (8 - fecha.getUTCDay()) % 7)

// Domingo de Pascua (algoritmo gregoriano anónimo).
function pascua(anio) {
  const a = anio % 19
  const b = Math.floor(anio / 100)
  const c = anio % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return utc(anio, mes, dia)
}

// Lista completa de festivos del año (18 en total), ordenada por fecha.
export function festivosDelAnio(anio) {
  const E = pascua(anio)
  const lista = [
    [utc(anio, 1, 1), 'Año Nuevo'],
    [alLunes(utc(anio, 1, 6)), 'Epifanía (Reyes Magos)'],
    [alLunes(utc(anio, 3, 19)), 'San José'],
    [plusDias(E, -3), 'Jueves Santo'],
    [plusDias(E, -2), 'Viernes Santo'],
    [utc(anio, 5, 1), 'Día del Trabajo'],
    [plusDias(E, 43), 'Ascensión del Señor'],
    [plusDias(E, 64), 'Corpus Christi'],
    [plusDias(E, 68), 'Sagrado Corazón de Jesús'],
    [alLunes(utc(anio, 6, 29)), 'San Pedro y San Pablo'],
    [utc(anio, 7, 20), 'Independencia de Colombia'],
    [utc(anio, 8, 7), 'Batalla de Boyacá'],
    [alLunes(utc(anio, 8, 15)), 'Asunción de la Virgen'],
    [alLunes(utc(anio, 10, 12)), 'Día de la Raza'],
    [alLunes(utc(anio, 11, 1)), 'Todos los Santos'],
    [alLunes(utc(anio, 11, 11)), 'Independencia de Cartagena'],
    [utc(anio, 12, 8), 'Inmaculada Concepción'],
    [utc(anio, 12, 25), 'Navidad'],
  ]
  return lista
    .map(([d, nombre]) => ({ fecha: iso(d), nombre }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}

// ¿Es una fecha no laboral? Domingo o festivo nacional.
// festivos: Map fecha → nombre, o Set/array de 'AAAA-MM-DD'.
export function noLaboralInfo(fechaIso, festivos = null) {
  const fecha = String(fechaIso || '').slice(0, 10)
  if (!fecha) return { es_no_laboral: false, motivo: null }
  let nombre = null
  if (festivos instanceof Map) {
    nombre = festivos.get(fecha) || null
  } else if (festivos && new Set(festivos).has(fecha)) {
    nombre = 'Festivo'
  }
  if (nombre) return { es_no_laboral: true, motivo: nombre }
  const dow = new Date(`${fecha}T00:00:00Z`).getUTCDay()
  if (dow === 0) return { es_no_laboral: true, motivo: 'Domingo' }
  return { es_no_laboral: false, motivo: null }
}

export function fechaLegible(fechaIso) {
  const [y, m, d] = String(fechaIso).slice(0, 10).split('-').map(Number)
  return `${d} de ${MESES[m - 1]} de ${y}`
}
