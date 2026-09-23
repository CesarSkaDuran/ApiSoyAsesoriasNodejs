import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import { all as catalogos } from '../controllers/catalogos.controller.js'

const router = Router()

router.get('/', authMiddleware, catalogos)

export default router
