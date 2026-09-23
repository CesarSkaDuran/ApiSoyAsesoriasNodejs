import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import {
  list as listSoportes, show as showSoporte,
  create as createSoporte, update as updateSoporte,
} from '../controllers/soportes.controller.js'

const router = Router()

router.get('/', authMiddleware, listSoportes)
router.get('/:id', authMiddleware, showSoporte)
router.post('/', authMiddleware, createSoporte)
router.put('/:id', authMiddleware, updateSoporte)

export default router
