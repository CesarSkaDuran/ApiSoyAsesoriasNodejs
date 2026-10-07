import 'dotenv/config'
import { createServer } from 'node:http'
import { pino } from 'pino'

import app from './app.js'
import { runMigrations } from './db/migrations.js'
import { attachSocketServer } from './realtime/socket.js'
import { avisarTerminaciones } from './services/avisos-contratos.js'

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

  // Aviso de vencimiento de contratos a término fijo (30 días antes):
  // al arrancar y luego cada 24h.
  const avisos = () => avisarTerminaciones().catch(e => logger.error({ err: e }, 'Error en avisos de contratos'))
  void avisos()
  setInterval(avisos, 24 * 60 * 60 * 1000).unref()
}

void start()
