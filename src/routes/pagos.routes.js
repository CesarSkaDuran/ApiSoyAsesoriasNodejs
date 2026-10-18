import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'
import {
  list as listPagos, show as showPago, create as createPago, update as updatePago,
  listComprobantes, uploadComprobante, downloadComprobante, verificarComprobante,
  listAbonos, registrarAbono, anularAbono, cartera,
} from '../controllers/pagos.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('pagos'), listPagos)
router.get('/cartera', authMiddleware, requireRole('admin', 'asesor'), requireModulo('pagos'), cartera)
router.put('/abonos/:aid/anular', authMiddleware, requireRole('admin', 'asesor'), requireModulo('pagos'), anularAbono)
router.get('/:id/abonos', authMiddleware, requireModulo('pagos'), listAbonos)
router.post('/:id/abonos', authMiddleware, requireRole('admin', 'asesor'), requireModulo('pagos'), registrarAbono)
router.get('/comprobantes/:cid/download', authMiddleware, requireModulo('pagos'), downloadComprobante)
router.put('/comprobantes/:cid/verificar', authMiddleware, requireRole('admin', 'asesor'), requireModulo('pagos'), verificarComprobante)
router.get('/:id/comprobantes', authMiddleware, requireModulo('pagos'), listComprobantes)
router.post('/:id/comprobantes', authMiddleware, requireModulo('pagos'), upload.single('archivo'), uploadComprobante)
router.get('/:id', authMiddleware, requireModulo('pagos'), showPago)
router.post('/', authMiddleware, requireRole('admin', 'asesor'), requireModulo('pagos'), createPago)
router.put('/:id', authMiddleware, requireRole('admin', 'asesor'), requireModulo('pagos'), updatePago)

export default router
