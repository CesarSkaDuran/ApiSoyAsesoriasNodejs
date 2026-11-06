import { Router } from 'express'
import { authMiddleware, requireModulo, requireRole } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'
import {
  listFolders, createFolder, updateFolder, deleteFolder,
  listDocuments, uploadDocument, downloadDocument, updateDocument, deleteDocument, listTypes,
  listCatalog, listAdminCatalog, updateCatalogDocument, uploadDraft, downloadDraft,
  uploadCatalogDocument, downloadCatalogDocument, createCatalogRequest, createCatalogCategory,
  createCatalogDocument,
} from '../controllers/gestor-documental.controller.js'

const router = Router()
router.use(authMiddleware, requireRole('admin', 'asesor', 'empresa'), requireModulo('gestor_documental'))

router.get('/carpetas', listFolders)
router.get('/tipos', listTypes)
router.get('/catalogo', listCatalog)
router.get('/admin/catalogo', requireRole('admin'), listAdminCatalog)
router.post('/admin/categorias', requireRole('admin'), createCatalogCategory)
router.post('/admin/catalogo', requireRole('admin'), createCatalogDocument)
router.put('/admin/catalogo/:id', requireRole('admin'), updateCatalogDocument)
router.post('/admin/catalogo/:id/borrador', requireRole('admin'), upload.single('file'), uploadDraft)
router.get('/catalogo/:id/borrador', downloadDraft)
router.post('/catalogo/:id/archivo', upload.single('file'), uploadCatalogDocument)
router.get('/archivos/:id', downloadCatalogDocument)
router.post('/solicitudes', createCatalogRequest)
router.post('/carpetas', createFolder)
router.put('/carpetas/:id', updateFolder)
router.delete('/carpetas/:id', deleteFolder)
router.get('/documentos', listDocuments)
router.post('/documentos', upload.single('file'), uploadDocument)
router.get('/documentos/:id/download', downloadDocument)
router.put('/documentos/:id', updateDocument)
router.delete('/documentos/:id', deleteDocument)

export default router
