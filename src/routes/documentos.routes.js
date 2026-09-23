import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'
import { uploadDoc, list as listDocs, download, remove as removeDoc } from '../controllers/documentos.controller.js'

const router = Router()

// Storage privado: subida con multer, descarga solo autenticada
router.get('/', authMiddleware, listDocs)
router.post('/', authMiddleware, upload.single('file'), uploadDoc)
router.get('/:id/download', authMiddleware, download)
router.delete('/:id', authMiddleware, removeDoc)

export default router
