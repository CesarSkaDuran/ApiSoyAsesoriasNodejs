import { Router } from 'express'
import { authMiddleware, requireRole, requireModulo } from '../middlewares/auth.js'
import {
  listRegistros, showRegistro, createRegistro, updateRegistro, listCatalogo,
} from '../controllers/servicios.controller.js'

// Se monta en '/' porque el contrato expone dos prefijos:
//   /servicios-catalogo y /servicio-registros
const router = Router()

router.get('/servicios-catalogo', authMiddleware, requireModulo('servicios'), listCatalogo)
router.get('/servicio-registros', authMiddleware, requireModulo('servicios'), listRegistros)
router.get('/servicio-registros/:id', authMiddleware, requireModulo('servicios'), showRegistro)
router.post('/servicio-registros', authMiddleware, requireRole('admin', 'asesor'), requireModulo('servicios'), createRegistro)
router.put('/servicio-registros/:id', authMiddleware, requireRole('admin', 'asesor'), requireModulo('servicios'), updateRegistro)

export default router
