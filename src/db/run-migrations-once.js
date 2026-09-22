import 'dotenv/config'
import db from './knex.js'
import { runMigrations } from './migrations.js'

try {
  await runMigrations()
  console.log('OK')
} catch (err) {
  console.error('Error en migraciones:', err)
  process.exitCode = 1
} finally {
  await db.destroy()
}
