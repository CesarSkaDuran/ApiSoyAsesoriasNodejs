import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import {
  list as listNominas, show as showNomina, create as createNomina,
  liquidar as liquidarNomina, generarPlanilla, remove as removeNomina,
} from '../controllers/nominas.controller.js'

const router = Router()

router.get('/', authMiddleware, listNominas)
router.get('/:id', authMiddleware, showNomina)
router.post('/', authMiddleware, requireRole('admin'), createNomina)
router.put('/:id/liquidar', authMiddleware, requireRole('admin'), liquidarNomina)
router.post('/:id/planilla', authMiddleware, requireRole('admin'), generarPlanilla)
router.delete('/:id', authMiddleware, requireRole('admin'), removeNomina)

export default router
