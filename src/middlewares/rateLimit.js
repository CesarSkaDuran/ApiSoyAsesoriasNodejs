// Rate limiter en memoria (ventana fija por IP+path).
// Sin dependencias: suficiente para un despliegue single-instance.
// Si escala a multi-instancia, reemplazar por express-rate-limit + Redis.
export function rateLimit({ windowMs = 60_000, max = 20, message = 'Demasiadas solicitudes' } = {}) {
  const hits = new Map() // key -> { count, reset }

  // Limpieza periódica para no acumular entradas expiradas
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
  }, windowMs)
  timer.unref?.()

  return (req, res, next) => {
    const key = `${req.ip}|${req.path}`
    const now = Date.now()
    let entry = hits.get(key)
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs }
      hits.set(key, entry)
    }
    entry.count += 1

    res.setHeader('X-RateLimit-Limit', max)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count))

    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000))
      return res.status(429).json({ error: message })
    }
    next()
  }
}
