import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'
import {
  list as listDiagnosticos, show as showDiagnostico, create as createDiagnostico,
  update as updateDiagnostico, updateEstado, remove as removeDiagnostico,
  entrevista, saveRespuestas, documentos as diagDocumentos,
  uploadDocumento, revisarDocumento, downloadDocumento,
  getInforme, saveInforme,
  listPreguntas, createPregunta, updatePregunta, deletePregunta,
  listDocConfigs, createDocConfig, updateDocConfig, deleteDocConfig,
} from '../controllers/diagnosticos.controller.js'

// Se monta en '/' porque el contrato usa dos prefijos:
//   /diagnosticos y /diagnostico-config
const router = Router()

router.get('/diagnosticos', authMiddleware, requireModulo('diagnosticos'), listDiagnosticos)
router.post('/diagnosticos', authMiddleware, requireRole('admin', 'asesor'), requireModulo('diagnosticos'), createDiagnostico)
router.get('/diagnosticos/documentos/:docId/download', authMiddleware, requireModulo('diagnosticos'), downloadDocumento)
router.put('/diagnosticos/documentos/:docId', authMiddleware, requireRole('admin', 'asesor'), requireModulo('diagnosticos'), revisarDocumento)
router.get('/diagnosticos/:id', authMiddleware, requireModulo('diagnosticos'), showDiagnostico)
router.put('/diagnosticos/:id', authMiddleware, requireRole('admin', 'asesor'), requireModulo('diagnosticos'), updateDiagnostico)
router.put('/diagnosticos/:id/estado', authMiddleware, requireModulo('diagnosticos'), updateEstado)
router.delete('/diagnosticos/:id', authMiddleware, requireRole('admin', 'asesor'), requireModulo('diagnosticos'), removeDiagnostico)

// entrevista
router.get('/diagnosticos/:id/entrevista', authMiddleware, requireModulo('diagnosticos'), entrevista)
router.put('/diagnosticos/:id/respuestas', authMiddleware, requireModulo('diagnosticos'), saveRespuestas)

// documentos del diagnóstico
router.get('/diagnosticos/:id/documentos', authMiddleware, requireModulo('diagnosticos'), diagDocumentos)
router.post('/diagnosticos/:id/documentos/:configId', authMiddleware, requireModulo('diagnosticos'), upload.single('archivo'), uploadDocumento)

// informe
router.get('/diagnosticos/:id/informe', authMiddleware, requireModulo('diagnosticos'), getInforme)
router.put('/diagnosticos/:id/informe', authMiddleware, requireRole('admin', 'asesor'), requireModulo('diagnosticos'), saveInforme)

// configuración (admin)
const config = Router()
config.use(authMiddleware, requireRole('admin'))
config.get('/preguntas', listPreguntas)
config.post('/preguntas', createPregunta)
config.put('/preguntas/:id', updatePregunta)
config.delete('/preguntas/:id', deletePregunta)
config.get('/documentos', listDocConfigs)
config.post('/documentos', createDocConfig)
config.put('/documentos/:id', updateDocConfig)
config.delete('/documentos/:id', deleteDocConfig)
router.use('/diagnostico-config', config)

export default router
