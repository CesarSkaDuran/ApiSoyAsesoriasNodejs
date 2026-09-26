import multer from 'multer'
import { mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import { extname, resolve } from 'path'

// Uploads a storage privado (fuera de cualquier docroot publico).
// Nombre generado en servidor (UUID) -> no hay path traversal ni sobreescritura.
// La descarga se hace por endpoint autenticado en documentos.controller.js

const STORAGE_DIR = resolve(process.env.STORAGE_DIR || 'storage/documentos')
mkdirSync(STORAGE_DIR, { recursive: true })

const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.zip']
const MAX_SIZE = 20 * 1024 * 1024 // 20 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, STORAGE_DIR),
  filename: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase()
    cb(null, `${randomUUID()}${ext}`)
  },
})

function fileFilter(req, file, cb) {
  const ext = extname(file.originalname).toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) {
    const err = new Error(
      `Tipo de archivo no permitido: ${ext || '(sin extensión)'}. Permitidos: ${ALLOWED_EXT.join(', ')}`
    )
    err.status = 400
    return cb(err)
  }
  cb(null, true)
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE },
})
