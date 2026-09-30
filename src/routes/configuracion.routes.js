import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import { getCorreo, putCorreo, probarCorreo } from '../controllers/configuracion.controller.js'

const router = Router()

router.use(authMiddleware, requireRole('admin'))

router.get('/correo', getCorreo)
router.put('/correo', putCorreo)
router.post('/correo/probar', probarCorreo)

export default router
