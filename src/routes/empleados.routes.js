import { Router } from 'express'
import { authMiddleware, requireRole, scopeEmpresa } from '../middlewares/auth.js'
import {
  list as listEmpleados, show as showEmpleado, create as createEmpleado, contratar,
  update as updateEmpleado, remove as removeEmpleado, retirarLote, recontratar,
  addBeneficiario, removeBeneficiario,
  addIncapacidad, updateIncapacidad, removeIncapacidad,
} from '../controllers/empleados.controller.js'

const router = Router()

router.get('/', authMiddleware, listEmpleados)
router.post('/retirar-lote', authMiddleware, requireRole('admin'), retirarLote)
router.post('/:id/recontratar', authMiddleware, requireRole('admin'), recontratar)
router.get('/:id', authMiddleware, showEmpleado)
router.post('/contratar', authMiddleware, requireRole('admin', 'empresa'), scopeEmpresa(), contratar)
router.post('/', authMiddleware, requireRole('admin', 'empresa'), scopeEmpresa(), createEmpleado)
router.put('/:id', authMiddleware, updateEmpleado)
router.delete('/:id', authMiddleware, requireRole('admin'), removeEmpleado)

// subrecursos
router.post('/:id/beneficiarios', authMiddleware, addBeneficiario)
router.delete('/:id/beneficiarios/:bid', authMiddleware, removeBeneficiario)
router.post('/:id/incapacidades', authMiddleware, addIncapacidad)
router.put('/:id/incapacidades/:iid', authMiddleware, updateIncapacidad)
router.delete('/:id/incapacidades/:iid', authMiddleware, removeIncapacidad)

export default router
