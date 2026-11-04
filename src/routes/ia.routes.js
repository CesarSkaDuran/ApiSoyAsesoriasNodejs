import { Router } from 'express'
import { authMiddleware, requireModulo, requireRole } from '../middlewares/auth.js'
import {
  chat, listSessions, createSession, showSession, deleteSession,
} from '../controllers/ia.controller.js'

const router = Router()
router.use(authMiddleware, requireRole('admin', 'asesor', 'empresa', 'independiente'), requireModulo('ia'))

router.get('/sesiones', listSessions)
router.post('/sesiones', createSession)
router.get('/sesiones/:id', showSession)
router.delete('/sesiones/:id', deleteSession)
router.post('/chat', chat)

export default router
