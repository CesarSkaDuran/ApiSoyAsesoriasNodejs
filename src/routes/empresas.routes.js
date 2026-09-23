import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import {
  list as listEmpresas, show as showEmpresa, create as createEmpresa,
  update as updateEmpresa, addServicio, removeServicio,
} from '../controllers/empresas.controller.js'

const router = Router()

router.get('/', authMiddleware, listEmpresas)
router.get('/:id', authMiddleware, showEmpresa)
router.post('/', authMiddleware, requireRole('admin'), createEmpresa)
router.put('/:id', authMiddleware, updateEmpresa)
router.post('/:id/servicios', authMiddleware, requireRole('admin'), addServicio)
router.delete('/:id/servicios/:servicioId', authMiddleware, requireRole('admin'), removeServicio)

export default router
