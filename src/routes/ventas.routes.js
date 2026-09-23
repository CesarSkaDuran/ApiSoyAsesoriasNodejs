import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import { rateLimit } from '../middlewares/rateLimit.js'
import {
  index as ventasIndex, embudo as ventasEmbudo, showLead, createLead, updateLead,
  moveLead, convertirLead, deleteLead, ingestLead,
  createEmbudo, updateEmbudo, createEtapa, updateEtapa, deleteEtapa,
} from '../controllers/ventas.controller.js'

const router = Router()

// Público (formularios web): token + rate limit por IP.
// Configurable: INGEST_RATE_LIMIT (default 10), INGEST_RATE_WINDOW_MS (default 60000)
const ingestLimiter = rateLimit({
  windowMs: Number(process.env.INGEST_RATE_WINDOW_MS) || 60_000,
  max: Number(process.env.INGEST_RATE_LIMIT) || 10,
  message: 'Demasiados envíos, inténtalo más tarde',
})
router.post('/ingest', ingestLimiter, ingestLead)

// Autenticado
router.get('/', authMiddleware, ventasIndex)
router.get('/embudo/:slug', authMiddleware, ventasEmbudo)
router.post('/embudos', authMiddleware, requireRole('admin'), createEmbudo)
router.put('/embudos/:id', authMiddleware, requireRole('admin'), updateEmbudo)
router.post('/embudos/:id/etapas', authMiddleware, requireRole('admin'), createEtapa)
router.put('/etapas/:id', authMiddleware, requireRole('admin'), updateEtapa)
router.delete('/etapas/:id', authMiddleware, requireRole('admin'), deleteEtapa)
router.get('/leads/:id', authMiddleware, showLead)
router.post('/leads', authMiddleware, createLead)
router.put('/leads/:id', authMiddleware, updateLead)
router.put('/leads/:id/etapa', authMiddleware, moveLead)
router.post('/leads/:id/convertir', authMiddleware, convertirLead)
router.delete('/leads/:id', authMiddleware, requireRole('admin'), deleteLead)

export default router
