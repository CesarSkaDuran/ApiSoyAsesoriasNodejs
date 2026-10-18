import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import {
  list as listNominas, show as showNomina, create as createNomina,
  liquidar as liquidarNomina, generarPlanilla, remove as removeNomina,
  getParametros, updateParametros, novedades as novedadesNomina,
  listConceptos, createConcepto, updateConcepto, pilaEstado, plano,
  normativa, listFestivos, valorHora,
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
// Consulta normativa: valores vigentes, festivos y calculadora de hora.
// Son datos públicos de ley; los lee cualquier usuario con módulo nóminas.
router.get('/normativa', authMiddleware, requireModulo('nominas'), normativa)
router.get('/festivos', authMiddleware, requireModulo('nominas'), listFestivos)
router.get('/valor-hora', authMiddleware, requireModulo('nominas'), valorHora)
router.get('/', authMiddleware, requireModulo('nominas'), listNominas)
router.get('/:id', authMiddleware, requireModulo('nominas'), showNomina)
router.post('/', authMiddleware, requireRole('admin', 'asesor'), requireModulo('nominas'), createNomina)
router.get('/:id/novedades', authMiddleware, requireModulo('nominas'), novedadesNomina)
router.get('/:id/plano', authMiddleware, requireModulo('nominas'), plano)
router.put('/:id/liquidar', authMiddleware, requireRole('admin', 'asesor'), requireModulo('nominas'), liquidarNomina)
router.post('/:id/planilla', authMiddleware, requireRole('admin', 'asesor'), requireModulo('nominas'), generarPlanilla)
router.delete('/:id', authMiddleware, requireRole('admin', 'asesor'), requireModulo('nominas'), removeNomina)

export default router
