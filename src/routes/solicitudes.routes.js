import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'
import {
  listRequestedDocuments, uploadRequestedDocument, downloadRequestedDocument,
} from '../controllers/gestor-documental.controller.js'
import {
  list as listSolicitudes, show as showSolicitud,
  create as createSolicitud, update as updateSolicitud,
  uploadRespuesta, downloadRespuesta, deleteRespuesta,
  listPlantillasRRHH, savePlantillaRRHH, generarDocumentoRRHH,
} from '../controllers/solicitudes.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('solicitudes'), listSolicitudes)
router.get('/plantillas-rrhh', authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('solicitudes'), listPlantillasRRHH)
router.put('/plantillas-rrhh', authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('solicitudes'), savePlantillaRRHH)
router.post('/:id/generar-documento-rrhh', authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('solicitudes'), generarDocumentoRRHH)
router.get('/:id/gestor-documentos', authMiddleware, requireModulo('solicitudes'), listRequestedDocuments)
router.post('/:id/gestor-documentos/:catalogoId', authMiddleware, requireRole('admin', 'asesor'), requireModulo('solicitudes'), upload.single('file'), uploadRequestedDocument)
router.get('/:id/gestor-documentos/:catalogoId/download', authMiddleware, requireModulo('solicitudes'), downloadRequestedDocument)
router.get('/:id', authMiddleware, requireModulo('solicitudes'), showSolicitud)
router.post('/', authMiddleware, requireModulo('solicitudes'), createSolicitud)
router.put('/:id', authMiddleware, requireModulo('solicitudes'), updateSolicitud)
router.put('/:id/respuesta', authMiddleware, requireModulo('solicitudes'), upload.single('file'), uploadRespuesta)
router.get('/:id/respuesta', authMiddleware, requireModulo('solicitudes'), downloadRespuesta)
router.delete('/:id/respuesta', authMiddleware, requireModulo('solicitudes'), deleteRespuesta)

export default router
