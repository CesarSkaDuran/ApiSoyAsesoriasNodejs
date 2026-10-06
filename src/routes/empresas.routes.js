import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import {
  list as listEmpresas, show as showEmpresa, create as createEmpresa,
  update as updateEmpresa, addServicio, removeServicio,
} from '../controllers/empresas.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('empresas'), listEmpresas)
router.get('/:id', authMiddleware, requireModulo('empresas'), showEmpresa)
router.post('/', authMiddleware, requireRole('admin', 'asesor'), requireModulo('empresas'), createEmpresa)
router.put('/:id', authMiddleware, requireModulo('empresas'), updateEmpresa)
router.post('/:id/servicios', authMiddleware, requireRole('admin', 'asesor'), requireModulo('empresas'), addServicio)
router.delete('/:id/servicios/:servicioId', authMiddleware, requireRole('admin', 'asesor'), requireModulo('empresas'), removeServicio)

export default router
