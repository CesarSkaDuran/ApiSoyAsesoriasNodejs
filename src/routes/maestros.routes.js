import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import {
  index as maestrosIndex, list as maestrosList, create as maestrosCreate,
  update as maestrosUpdate, remove as maestrosRemove,
} from '../controllers/maestros.controller.js'

const router = Router()

router.use(authMiddleware, requireRole('admin'))
router.get('/', maestrosIndex)
router.get('/:catalogo', maestrosList)
router.post('/:catalogo', maestrosCreate)
router.put('/:catalogo/:id', maestrosUpdate)
router.delete('/:catalogo/:id', maestrosRemove)

export default router
