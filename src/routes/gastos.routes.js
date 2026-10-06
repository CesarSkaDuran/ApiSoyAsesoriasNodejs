import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import {
  list as listGastos, show as showGasto, create as createGasto,
  update as updateGasto, remove as removeGasto,
} from '../controllers/gastos.controller.js'

const router = Router()

router.use(authMiddleware, requireRole('admin', 'asesor'), requireModulo('gastos'))
router.get('/', listGastos)
router.get('/:id', showGasto)
router.post('/', createGasto)
router.put('/:id', updateGasto)
router.delete('/:id', removeGasto)

export default router
