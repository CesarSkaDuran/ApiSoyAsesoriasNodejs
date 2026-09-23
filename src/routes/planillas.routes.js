import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import {
  list as listPlanillas, show as showPlanilla,
  create as createPlanilla, update as updatePlanilla,
} from '../controllers/planillas.controller.js'

const router = Router()

router.get('/', authMiddleware, listPlanillas)
router.get('/:id', authMiddleware, showPlanilla)
router.post('/', authMiddleware, requireRole('admin'), createPlanilla)
router.put('/:id', authMiddleware, requireRole('admin'), updatePlanilla)

export default router
