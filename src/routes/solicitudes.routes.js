import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import {
  list as listSolicitudes, show as showSolicitud,
  create as createSolicitud, update as updateSolicitud,
} from '../controllers/solicitudes.controller.js'

const router = Router()

router.get('/', authMiddleware, listSolicitudes)
router.get('/:id', authMiddleware, showSolicitud)
router.post('/', authMiddleware, createSolicitud)
router.put('/:id', authMiddleware, updateSolicitud)

export default router
