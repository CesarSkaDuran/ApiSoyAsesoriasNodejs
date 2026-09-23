import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import {
  list as listEmpleados, show as showEmpleado, create as createEmpleado,
  update as updateEmpleado, remove as removeEmpleado,
  addBeneficiario, removeBeneficiario,
  addIncapacidad, updateIncapacidad, removeIncapacidad,
} from '../controllers/empleados.controller.js'

const router = Router()

router.get('/', authMiddleware, listEmpleados)
router.get('/:id', authMiddleware, showEmpleado)
router.post('/', authMiddleware, createEmpleado)
router.put('/:id', authMiddleware, updateEmpleado)
router.delete('/:id', authMiddleware, removeEmpleado)

// subrecursos
router.post('/:id/beneficiarios', authMiddleware, addBeneficiario)
router.delete('/:id/beneficiarios/:bid', authMiddleware, removeBeneficiario)
router.post('/:id/incapacidades', authMiddleware, addIncapacidad)
router.put('/:id/incapacidades/:iid', authMiddleware, updateIncapacidad)
router.delete('/:id/incapacidades/:iid', authMiddleware, removeIncapacidad)

export default router
