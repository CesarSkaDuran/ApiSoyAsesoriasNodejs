import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import {
  list as listPagos, show as showPago, create as createPago, update as updatePago,
} from '../controllers/pagos.controller.js'

const router = Router()

router.get('/', authMiddleware, listPagos)
router.get('/:id', authMiddleware, showPago)
router.post('/', authMiddleware, requireRole('admin'), createPago)
router.put('/:id', authMiddleware, requireRole('admin'), updatePago)

export default router
