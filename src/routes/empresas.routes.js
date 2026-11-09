import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'
import {
  list as listEmpresas, show as showEmpresa, create as createEmpresa,
  update as updateEmpresa, addServicio, removeServicio,
  updateBranding, getBrandingFile,
  listSucursales, createSucursal, updateSucursal,
  listCentrosTrabajo, createCentroTrabajo, updateCentroTrabajo, deactivateCentroTrabajo,
} from '../controllers/empresas.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('empresas'), listEmpresas)
router.get('/:id/sucursales', authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('empresas'), listSucursales)
router.post('/:id/sucursales', authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('empresas'), createSucursal)
router.put('/:id/sucursales/:sucursalId', authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('empresas'), updateSucursal)
router.get('/:id/centros-trabajo', authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('empresas'), listCentrosTrabajo)
router.post('/:id/centros-trabajo', authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('empresas'), createCentroTrabajo)
router.put('/:id/centros-trabajo/:centroId', authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('empresas'), updateCentroTrabajo)
router.delete('/:id/centros-trabajo/:centroId', authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('empresas'), deactivateCentroTrabajo)
router.get('/:id', authMiddleware, requireModulo('empresas'), showEmpresa)
router.put('/:id/branding', authMiddleware, requireModulo('empresas'), upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'firma', maxCount: 1 }]), updateBranding)
router.get('/:id/branding/:tipo', authMiddleware, requireModulo('empresas'), getBrandingFile)
router.post('/', authMiddleware, requireRole('admin', 'asesor'), requireModulo('empresas'), createEmpresa)
router.put('/:id', authMiddleware, requireModulo('empresas'), updateEmpresa)
router.post('/:id/servicios', authMiddleware, requireRole('admin', 'asesor'), requireModulo('empresas'), addServicio)
router.delete('/:id/servicios/:servicioId', authMiddleware, requireRole('admin', 'asesor'), requireModulo('empresas'), removeServicio)

export default router
