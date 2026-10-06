import knex from 'knex'
import 'dotenv/config'

// Pool ajustable por env para picos de carga:
//   DB_POOL_MAX   conexiones máximas simultáneas (default 20)
//   DB_POOL_MIN   conexiones mínimas calientes    (default 2)
// Los timeouts evitan requests colgados esperando conexión libre
// y reciclan conexiones ociosas para no agotar max_connections de MySQL.
const db = knex({
  client: 'mysql2',
  connection: {
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME     || 'soyasesorias_db',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
    timezone: 'Z',
  },
  pool: {
    min: Number(process.env.DB_POOL_MIN) || 2,
    max: Number(process.env.DB_POOL_MAX) || 20,
    acquireTimeoutMillis: Number(process.env.DB_POOL_ACQUIRE_MS) || 30_000,
    createTimeoutMillis: 5_000,
    destroyTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    reapIntervalMillis: 1_000,
    createRetryIntervalMillis: 200,
    // El servidor anterior de la app no tenía ONLY_FULL_GROUP_BY; las
    // consultas con COUNT(*) + joins asumen ese comportamiento. Se ajusta
    // por conexión para que WAMP (5.7) y MySQL 8 se comporten igual.
    afterCreate(conn, done) {
      conn.query("SET SESSION sql_mode = 'IGNORE_SPACE,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'", (err) => {
        done(err, conn)
      })
    },
  },
})

export default db
