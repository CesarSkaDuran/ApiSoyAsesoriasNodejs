import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { pino } from 'pino'

import { runMigrations } from './db/migrations.js'
import routes from './routes/index.js'

const logger = pino()
const app = express()

const corsOptions = {
  origin: (process.env.CORS_ORIGIN || 'http://localhost:4200').split(','),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}

app.use(cors(corsOptions))
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true, limit: '20mb' }))

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'soyasesorias-api' }))

app.use('/api', routes)

// Manejo de errores central
app.use((err, req, res, next) => {
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: `Error de archivo: ${err.message}` })
  }
  logger.error(err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

const PORT = process.env.PORT || 3000

try {
  await runMigrations()
} catch (err) {
  logger.error({ err }, 'Error ejecutando migraciones')
}

app.listen(PORT, () => {
  logger.info(`API SoyAsesorias en http://localhost:${PORT}`)
})
