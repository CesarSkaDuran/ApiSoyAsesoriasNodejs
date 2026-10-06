import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo, scopeEmpresa } from '../middlewares/auth.js'
import {
  list as listEmpleados, show as showEmpleado, create as createEmpleado, contratar,
  update as updateEmpleado, remove as removeEmpleado, retirarLote, recontratar,
  addBeneficiario, removeBeneficiario,
  addIncapacidad, updateIncapacidad, removeIncapacidad,
} from '../controllers/empleados.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('empleados'), listEmpleados)
router.post('/retirar-lote', authMiddleware, requireRole('admin', 'asesor'), requireModulo('empleados'), retirarLote)
router.post('/:id/recontratar', authMiddleware, requireRole('admin', 'asesor'), requireModulo('empleados'), recontratar)
router.get('/:id', authMiddleware, requireModulo('empleados'), showEmpleado)
router.post('/contratar', authMiddleware, requireRole('admin', 'asesor', 'empresa'), scopeEmpresa(), contratar)
router.post('/', authMiddleware, requireRole('admin', 'asesor', 'empresa'), scopeEmpresa(), createEmpleado)
router.put('/:id', authMiddleware, requireModulo('empleados'), updateEmpleado)
router.delete('/:id', authMiddleware, requireRole('admin', 'asesor'), requireModulo('empleados'), removeEmpleado)

// subrecursos
router.post('/:id/beneficiarios', authMiddleware, requireModulo('empleados'), addBeneficiario)
router.delete('/:id/beneficiarios/:bid', authMiddleware, requireModulo('empleados'), removeBeneficiario)
router.post('/:id/incapacidades', authMiddleware, requireModulo('empleados'), addIncapacidad)
router.put('/:id/incapacidades/:iid', authMiddleware, requireModulo('empleados'), updateIncapacidad)
router.delete('/:id/incapacidades/:iid', authMiddleware, requireModulo('empleados'), removeIncapacidad)

export default router
