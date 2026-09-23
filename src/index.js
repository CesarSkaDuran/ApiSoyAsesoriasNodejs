import 'dotenv/config'
import { pino } from 'pino'

import app from './app.js'
import { runMigrations } from './db/migrations.js'

const logger = pino()
const PORT = process.env.PORT || 3000

try {
  await runMigrations()
} catch (err) {
  logger.error({ err }, 'Error ejecutando migraciones')
}

app.listen(PORT, () => {
  logger.info(`API SoyAsesorias en http://localhost:${PORT}`)
})
