import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import {
  listRegistros, showRegistro, createRegistro, updateRegistro, listCatalogo,
} from '../controllers/servicios.controller.js'

// Se monta en '/' porque el contrato expone dos prefijos:
//   /servicios-catalogo y /servicio-registros
const router = Router()

router.get('/servicios-catalogo', authMiddleware, listCatalogo)
router.get('/servicio-registros', authMiddleware, listRegistros)
router.get('/servicio-registros/:id', authMiddleware, showRegistro)
router.post('/servicio-registros', authMiddleware, createRegistro)
router.put('/servicio-registros/:id', authMiddleware, updateRegistro)

export default router
