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

// Panel comercial: solo staff (admin). Los clientes no deben ver ni
// manipular el pipeline ni convertir leads en empresas/personas.
router.use(authMiddleware, requireRole('admin'))
router.get('/', ventasIndex)
router.get('/embudo/:slug', ventasEmbudo)
router.post('/embudos', createEmbudo)
router.put('/embudos/:id', updateEmbudo)
router.post('/embudos/:id/etapas', createEtapa)
router.put('/etapas/:id', updateEtapa)
router.delete('/etapas/:id', deleteEtapa)
router.get('/leads/:id', showLead)
router.post('/leads', createLead)
router.put('/leads/:id', updateLead)
router.put('/leads/:id/etapa', moveLead)
router.post('/leads/:id/convertir', convertirLead)
router.delete('/leads/:id', deleteLead)

export default router
