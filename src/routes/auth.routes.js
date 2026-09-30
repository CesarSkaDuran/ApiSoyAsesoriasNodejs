import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import { login, logout, refresh, me, createUser, changePassword, terminos, aceptarTerminos } from '../controllers/auth.controller.js'

const router = Router()

router.post('/login', login)
router.post('/refresh', refresh)
router.get('/terminos', terminos)
router.post('/aceptar-terminos', authMiddleware, aceptarTerminos)
router.post('/logout', authMiddleware, logout)
router.get('/me', authMiddleware, me)
router.put('/change-password', authMiddleware, changePassword)
router.post('/users', authMiddleware, requireRole('admin'), createUser)

export default router
