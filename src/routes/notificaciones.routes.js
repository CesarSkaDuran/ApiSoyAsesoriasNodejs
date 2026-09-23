import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import { list, markAllRead, markRead } from '../controllers/notificaciones.controller.js'

const router = Router()

router.use(authMiddleware)
router.get('/', list)
router.put('/leidas', markAllRead)
router.put('/:id/leida', markRead)

export default router
