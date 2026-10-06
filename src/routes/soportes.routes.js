import { Router } from 'express'
import { authMiddleware, requireModulo } from '../middlewares/auth.js'
import {
  list as listSoportes, show as showSoporte,
  create as createSoporte, update as updateSoporte,
} from '../controllers/soportes.controller.js'

const router = Router()

router.get('/', authMiddleware, requireModulo('soportes'), listSoportes)
router.get('/:id', authMiddleware, requireModulo('soportes'), showSoporte)
router.post('/', authMiddleware, requireModulo('soportes'), createSoporte)
router.put('/:id', authMiddleware, requireModulo('soportes'), updateSoporte)

export default router
