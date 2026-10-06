import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import {
  list as listPagos, show as showPago, create as createPago, update as updatePago,
} from '../controllers/pagos.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('pagos'), listPagos)
router.get('/:id', authMiddleware, requireModulo('pagos'), showPago)
router.post('/', authMiddleware, requireRole('admin', 'asesor'), requireModulo('pagos'), createPago)
router.put('/:id', authMiddleware, requireRole('admin', 'asesor'), requireModulo('pagos'), updatePago)

export default router
