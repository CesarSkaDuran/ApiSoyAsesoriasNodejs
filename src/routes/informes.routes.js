import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import {
  ingresos, egresos, servicios as informeServicios, resumen, dashboard,
} from '../controllers/informes.controller.js'

const router = Router()

router.use(authMiddleware, requireRole('admin'))
router.get('/resumen', resumen)
router.get('/dashboard', dashboard)
router.get('/ingresos', ingresos)
router.get('/egresos', egresos)
router.get('/servicios', informeServicios)

export default router
