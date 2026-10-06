import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import {
  list as listPersonas, show as showPersona, buscar as buscarPersona,
  create as createPersona, update as updatePersona,
} from '../controllers/independientes.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('independientes'), listPersonas)
// Busqueda ciega de identidad (solo campos seguros): la usa tambien el
// flujo de contratacion de empleados — sin gate de modulo.
router.get('/buscar', authMiddleware, buscarPersona)
router.get('/:id', authMiddleware, requireModulo('independientes'), showPersona)
router.post('/', authMiddleware, requireRole('admin', 'asesor'), requireModulo('independientes'), createPersona)
router.put('/:id', authMiddleware, requireModulo('independientes'), updatePersona)

export default router
