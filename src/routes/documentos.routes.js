import { Router } from 'express'
import { authMiddleware, requireModulo } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'
import { uploadDoc, list as listDocs, listTipos, update as updateDoc, download, remove as removeDoc } from '../controllers/documentos.controller.js'

const router = Router()

// Storage privado: subida con multer, descarga solo autenticada
router.get('/tipos', authMiddleware, requireModulo('documentos'), listTipos)
router.get('/', authMiddleware, requireModulo('documentos'), listDocs)
router.post('/', authMiddleware, requireModulo('documentos'), upload.single('file'), uploadDoc)
router.put('/:id', authMiddleware, requireModulo('documentos'), updateDoc)
router.get('/:id/download', authMiddleware, requireModulo('documentos'), download)
router.delete('/:id', authMiddleware, requireModulo('documentos'), removeDoc)

export default router
