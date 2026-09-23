import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import { list as listAuditorias } from '../controllers/auditorias.controller.js'

const router = Router()

router.use(authMiddleware, requireRole('admin'))
router.get('/', listAuditorias)

export default router
