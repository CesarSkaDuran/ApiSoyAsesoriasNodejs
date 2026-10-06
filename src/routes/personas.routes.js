import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import {
  list as listPersonas, show as showPersona, buscar as buscarPersona,
  create as createPersona, update as updatePersona,
} from '../controllers/independientes.controller.js'

const router = Router()

router.get('/', authMiddleware, listPersonas)
router.get('/buscar', authMiddleware, buscarPersona)
router.get('/:id', authMiddleware, showPersona)
router.post('/', authMiddleware, requireRole('admin'), createPersona)
router.put('/:id', authMiddleware, updatePersona)

export default router
