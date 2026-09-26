// El frontend (mat-datepicker) envía fechas como ISO '2023-04-01T00:00:00.000Z'
// y MySQL strict las rechaza en columnas DATE (ER_TRUNCATED_WRONG_VALUE).
// Normaliza el body: campos fecha_* / desde / hasta → 'YYYY-MM-DD',
// y *_en / *_at (timestamps) → 'YYYY-MM-DD HH:mm:ss' UTC.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const DATE_FIELD = /^fecha_|^desde$|^hasta$|_fecha$/
const DATETIME_FIELD = /_en$|_at$/

function toSqlDate(iso) {
  return iso.slice(0, 10)
}

function toSqlDatetime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  )
}

function walk(value) {
  if (Array.isArray(value)) return value.map(walk)
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && ISO_RE.test(v)) {
        value[k] = DATETIME_FIELD.test(k) ? toSqlDatetime(v) : toSqlDate(v)
      } else {
        walk(v)
      }
    }
  }
  return value
}

export function normalizeDates(req, res, next) {
  if (req.body && typeof req.body === 'object') walk(req.body)
  next()
}
