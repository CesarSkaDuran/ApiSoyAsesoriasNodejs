import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import {
  list as listNominas, show as showNomina, create as createNomina,
  liquidar as liquidarNomina, generarPlanilla, remove as removeNomina,
  getParametros, updateParametros, novedades as novedadesNomina,
  listConceptos, createConcepto, updateConcepto, pilaEstado, plano,
} from '../controllers/nominas.controller.js'

const router = Router()

// Parametros/conceptos de nomina son configuracion global: solo admin
// (el asesor los consulta para liquidar, pero no los modifica).
router.get('/parametros/:vigencia', authMiddleware, requireRole('admin', 'asesor'), requireModulo('nominas'), getParametros)
router.put('/parametros/:vigencia', authMiddleware, requireRole('admin'), updateParametros)
router.get('/conceptos', authMiddleware, requireModulo('nominas'), listConceptos)
router.post('/conceptos', authMiddleware, requireRole('admin'), createConcepto)
router.put('/conceptos/:id', authMiddleware, requireRole('admin'), updateConcepto)
router.get('/pila-estado', authMiddleware, requireRole('admin', 'asesor'), requireModulo('nominas'), pilaEstado)
router.get('/', authMiddleware, requireModulo('nominas'), listNominas)
router.get('/:id', authMiddleware, requireModulo('nominas'), showNomina)
router.post('/', authMiddleware, requireRole('admin', 'asesor'), requireModulo('nominas'), createNomina)
router.get('/:id/novedades', authMiddleware, requireModulo('nominas'), novedadesNomina)
router.get('/:id/plano', authMiddleware, requireModulo('nominas'), plano)
router.put('/:id/liquidar', authMiddleware, requireRole('admin', 'asesor'), requireModulo('nominas'), liquidarNomina)
router.post('/:id/planilla', authMiddleware, requireRole('admin', 'asesor'), requireModulo('nominas'), generarPlanilla)
router.delete('/:id', authMiddleware, requireRole('admin', 'asesor'), requireModulo('nominas'), removeNomina)

export default router
