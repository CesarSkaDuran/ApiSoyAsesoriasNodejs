import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import {
  list as listUsuarios, show as showUsuario, update as updateUsuario,
} from '../controllers/usuarios.controller.js'

const router = Router()

router.use(authMiddleware, requireRole('admin'))
router.get('/', listUsuarios)
router.get('/:id', showUsuario)
router.put('/:id', updateUsuario)

export default router
