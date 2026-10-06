import { Router } from 'express'
import { authMiddleware, requireModulo } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'
import {
  list as listSolicitudes, show as showSolicitud,
  create as createSolicitud, update as updateSolicitud,
  uploadRespuesta, downloadRespuesta, deleteRespuesta,
} from '../controllers/solicitudes.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('solicitudes'), listSolicitudes)
router.get('/:id', authMiddleware, requireModulo('solicitudes'), showSolicitud)
router.post('/', authMiddleware, requireModulo('solicitudes'), createSolicitud)
router.put('/:id', authMiddleware, requireModulo('solicitudes'), updateSolicitud)
router.put('/:id/respuesta', authMiddleware, requireModulo('solicitudes'), upload.single('file'), uploadRespuesta)
router.get('/:id/respuesta', authMiddleware, requireModulo('solicitudes'), downloadRespuesta)
router.delete('/:id/respuesta', authMiddleware, requireModulo('solicitudes'), deleteRespuesta)

export default router
