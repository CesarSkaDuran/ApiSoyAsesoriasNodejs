import { existsSync, readFileSync } from 'fs'
import { resolve, sep } from 'path'

// Logo y firma de cada empresa viven en el storage privado. Para los
// documentos se incrustan como data URI, así el HTML se abre sin depender
// de cookies ni de la API.
export const STORAGE_DIR = resolve(process.env.STORAGE_DIR || 'storage/documentos')
export const IMAGE_MIMES = ['image/png', 'image/jpeg']

export function rutaStorage(filename) {
  if (!filename) return null
  const full = resolve(STORAGE_DIR, filename)
  return full.startsWith(`${STORAGE_DIR}${sep}`) && existsSync(full) ? full : null
}

export function imagenDataUri(filename, mime) {
  const full = rutaStorage(filename)
  if (!full || !IMAGE_MIMES.includes(mime)) return null
  return `data:${mime};base64,${readFileSync(full).toString('base64')}`
}
