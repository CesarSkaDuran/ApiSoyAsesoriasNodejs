import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'
import { uploadDoc, list as listDocs, listTipos, update as updateDoc, download, remove as removeDoc } from '../controllers/documentos.controller.js'

const router = Router()

// Storage privado: subida con multer, descarga solo autenticada
router.get('/tipos', authMiddleware, listTipos)
router.get('/', authMiddleware, listDocs)
router.post('/', authMiddleware, upload.single('file'), uploadDoc)
router.put('/:id', authMiddleware, updateDoc)
router.get('/:id/download', authMiddleware, download)
router.delete('/:id', authMiddleware, removeDoc)

export default router
