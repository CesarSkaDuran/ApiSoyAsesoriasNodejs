import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'
import {
  list as listSolicitudes, show as showSolicitud,
  create as createSolicitud, update as updateSolicitud,
  uploadRespuesta, downloadRespuesta, deleteRespuesta,
} from '../controllers/solicitudes.controller.js'

const router = Router()

router.get('/', authMiddleware, listSolicitudes)
router.get('/:id', authMiddleware, showSolicitud)
router.post('/', authMiddleware, createSolicitud)
router.put('/:id', authMiddleware, updateSolicitud)
router.put('/:id/respuesta', authMiddleware, upload.single('file'), uploadRespuesta)
router.get('/:id/respuesta', authMiddleware, downloadRespuesta)
router.delete('/:id/respuesta', authMiddleware, deleteRespuesta)

export default router
