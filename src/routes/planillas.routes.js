import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import {
  list as listPlanillas, show as showPlanilla,
  create as createPlanilla, update as updatePlanilla,
} from '../controllers/planillas.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('planillas'), listPlanillas)
router.get('/:id', authMiddleware, requireModulo('planillas'), showPlanilla)
router.post('/', authMiddleware, requireRole('admin', 'asesor'), requireModulo('planillas'), createPlanilla)
router.put('/:id', authMiddleware, requireRole('admin', 'asesor'), requireModulo('planillas'), updatePlanilla)

export default router
