import { Router } from 'express'

import authRoutes from './auth.routes.js'
import catalogosRoutes from './catalogos.routes.js'
import empresasRoutes from './empresas.routes.js'
import empleadosRoutes from './empleados.routes.js'
import nominasRoutes from './nominas.routes.js'
import documentosRoutes from './documentos.routes.js'
import serviciosRoutes from './servicios.routes.js'
import pagosRoutes from './pagos.routes.js'
import planillasRoutes from './planillas.routes.js'
import solicitudesRoutes from './solicitudes.routes.js'
import notificacionesRoutes from './notificaciones.routes.js'
import soportesRoutes from './soportes.routes.js'
import personasRoutes from './personas.routes.js'
import gastosRoutes from './gastos.routes.js'
import usuariosRoutes from './usuarios.routes.js'
import informesRoutes from './informes.routes.js'
import auditoriasRoutes from './auditorias.routes.js'
import maestrosRoutes from './maestros.routes.js'
import ventasRoutes from './ventas.routes.js'
import diagnosticosRoutes from './diagnosticos.routes.js'

const router = Router()

router.use('/auth', authRoutes)
router.use('/catalogos', catalogosRoutes)
router.use('/empresas', empresasRoutes)
router.use('/empleados', empleadosRoutes)
router.use('/nominas', nominasRoutes)
router.use('/documentos', documentosRoutes)
router.use('/pagos', pagosRoutes)
router.use('/planillas', planillasRoutes)
router.use('/solicitudes', solicitudesRoutes)
router.use('/notificaciones', notificacionesRoutes)
router.use('/soportes', soportesRoutes)
router.use('/personas', personasRoutes)
router.use('/gastos', gastosRoutes)
router.use('/usuarios', usuariosRoutes)
router.use('/informes', informesRoutes)
router.use('/auditorias', auditoriasRoutes)
router.use('/maestros', maestrosRoutes)
router.use('/ventas', ventasRoutes)

// Prefijos múltiples: /servicios-catalogo, /servicio-registros,
// /diagnosticos y /diagnostico-config
router.use('/', serviciosRoutes)
router.use('/', diagnosticosRoutes)

export default router
