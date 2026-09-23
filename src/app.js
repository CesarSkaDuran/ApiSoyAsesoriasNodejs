import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { pino } from 'pino'

import routes from './routes/index.js'
import { auditMutation } from './middlewares/audit.js'

// App Express sin side-effects (ni listen ni migraciones) para tests de integración.
const logger = pino()
const app = express()

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3873,http://localhost:4200'
const corsOptions = {
  origin: corsOrigin.trim() === '*' ? true : corsOrigin.split(',').map((o) => o.trim()),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}

app.use(cors(corsOptions))
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true, limit: '20mb' }))
app.use(auditMutation)

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

export default app
