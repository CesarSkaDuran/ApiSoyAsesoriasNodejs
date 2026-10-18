import { Router } from 'express'
import { authMiddleware, requireModulo } from '../middlewares/auth.js'
import {
  list as listPlanillas, show as showPlanilla, ingresos as ingresosPlanilla,
  create as createPlanilla, update as updatePlanilla,
} from '../controllers/planillas.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('planillas'), listPlanillas)
router.get('/ingresos', authMiddleware, requireModulo('planillas'), ingresosPlanilla)
router.get('/:id', authMiddleware, requireModulo('planillas'), showPlanilla)
router.post('/', authMiddleware, requireModulo('planillas'), createPlanilla)
router.put('/:id', authMiddleware, requireModulo('planillas'), updatePlanilla)

export default router
