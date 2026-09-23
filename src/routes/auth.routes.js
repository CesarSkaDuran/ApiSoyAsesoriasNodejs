import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import { login, logout, refresh, me, createUser } from '../controllers/auth.controller.js'

const router = Router()

router.post('/login', login)
router.post('/refresh', refresh)
router.post('/logout', authMiddleware, logout)
router.get('/me', authMiddleware, me)
router.post('/users', authMiddleware, requireRole('admin'), createUser)

export default router
