import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import {
  list as listNominas, show as showNomina, create as createNomina,
  liquidar as liquidarNomina, generarPlanilla, remove as removeNomina,
  getParametros, updateParametros, novedades as novedadesNomina,
  listConceptos, createConcepto, updateConcepto, pilaEstado, plano,
} from '../controllers/nominas.controller.js'

const router = Router()

router.get('/parametros/:vigencia', authMiddleware, requireRole('admin'), getParametros)
router.put('/parametros/:vigencia', authMiddleware, requireRole('admin'), updateParametros)
router.get('/conceptos', authMiddleware, listConceptos)
router.post('/conceptos', authMiddleware, requireRole('admin'), createConcepto)
router.put('/conceptos/:id', authMiddleware, requireRole('admin'), updateConcepto)
router.get('/pila-estado', authMiddleware, requireRole('admin'), pilaEstado)
router.get('/', authMiddleware, listNominas)
router.get('/:id', authMiddleware, showNomina)
router.post('/', authMiddleware, requireRole('admin'), createNomina)
router.get('/:id/novedades', authMiddleware, novedadesNomina)
router.get('/:id/plano', authMiddleware, plano)
router.put('/:id/liquidar', authMiddleware, requireRole('admin'), liquidarNomina)
router.post('/:id/planilla', authMiddleware, requireRole('admin'), generarPlanilla)
router.delete('/:id', authMiddleware, requireRole('admin'), removeNomina)

export default router
