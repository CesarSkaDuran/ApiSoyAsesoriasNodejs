import 'dotenv/config'
import { createServer } from 'node:http'
import { pino } from 'pino'

import app from './app.js'
import { runMigrations } from './db/migrations.js'
import { attachSocketServer } from './realtime/socket.js'

const logger = pino()
const PORT = process.env.PORT || 3000

async function start() {
  try {
    await runMigrations()
  } catch (err) {
    logger.error({ err }, 'Error ejecutando migraciones')
  }

  const server = createServer(app)
  attachSocketServer(server)
  server.listen(PORT, () => {
    logger.info(`API SoyAsesorias en http://localhost:${PORT}`)
  })
}

void start()
