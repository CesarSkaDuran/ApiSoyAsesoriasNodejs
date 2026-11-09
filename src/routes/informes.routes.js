import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import {
  ingresos, egresos, servicios as informeServicios, solicitudes as informeSolicitudes,
  nominasSucursales as informeNominasSucursales,
  clientesSolicitudes as informeClientesSolicitudes,
  resumen, dashboard, miResumen,
} from '../controllers/informes.controller.js'

const router = Router()

// Resumen del cliente logueado (empresa/independiente) — autenticado, scoped por tenant
router.get('/mi-resumen', authMiddleware, requireRole('empresa', 'independiente'), miResumen)

router.use(authMiddleware, requireRole('admin', 'asesor'), requireModulo('informes'))
router.get('/resumen', resumen)
router.get('/dashboard', dashboard)
router.get('/ingresos', ingresos)
router.get('/egresos', egresos)
router.get('/servicios', informeServicios)
router.get('/nominas-sucursales', informeNominasSucursales)
router.get('/solicitudes/clientes', informeClientesSolicitudes)
router.get('/solicitudes', informeSolicitudes)

export default router
