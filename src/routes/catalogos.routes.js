import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import { all as catalogos } from '../controllers/catalogos.controller.js'

const router = Router()

router.get('/', authMiddleware, requireRole('admin', 'asesor', 'empresa', 'independiente'), catalogos)

export default router
