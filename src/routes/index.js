import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import { upload } from '../middlewares/upload.js'

import { login, logout, me, createUser } from '../controllers/auth.controller.js'
import { list as listEmpresas, show as showEmpresa, create as createEmpresa, update as updateEmpresa, addServicio, removeServicio } from '../controllers/empresas.controller.js'
import { list as listEmpleados, show as showEmpleado, create as createEmpleado, update as updateEmpleado, remove as removeEmpleado, addBeneficiario, removeBeneficiario, addIncapacidad, updateIncapacidad, removeIncapacidad } from '../controllers/empleados.controller.js'
import { all as catalogos } from '../controllers/catalogos.controller.js'
import { uploadDoc, list as listDocs, download, remove as removeDoc } from '../controllers/documentos.controller.js'
import { list as listNominas, show as showNomina, create as createNomina, liquidar as liquidarNomina, generarPlanilla, remove as removeNomina } from '../controllers/nominas.controller.js'
import { listRegistros, showRegistro, createRegistro, updateRegistro, listCatalogo } from '../controllers/servicios.controller.js'
import { list as listPagos, show as showPago, create as createPago, update as updatePago } from '../controllers/pagos.controller.js'
import { list as listPlanillas, show as showPlanilla, create as createPlanilla, update as updatePlanilla } from '../controllers/planillas.controller.js'
import { list as listSolicitudes, create as createSolicitud, update as updateSolicitud } from '../controllers/solicitudes.controller.js'
import { list as listSoportes, create as createSoporte, update as updateSoporte } from '../controllers/soportes.controller.js'
import { list as listPersonas, show as showPersona, create as createPersona, update as updatePersona } from '../controllers/independientes.controller.js'
import { list as listGastos, create as createGasto, update as updateGasto, remove as removeGasto } from '../controllers/gastos.controller.js'
import { list as listUsuarios, show as showUsuario, update as updateUsuario } from '../controllers/usuarios.controller.js'
import { ingresos, egresos, servicios as informeServicios, resumen, dashboard } from '../controllers/informes.controller.js'

const router = Router()

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', login)
router.post('/auth/logout', authMiddleware, logout)
router.get('/auth/me', authMiddleware, me)
router.post('/auth/users', authMiddleware, requireRole('admin'), createUser)

// ── Catalogos ─────────────────────────────────────────────────────────────────
router.get('/catalogos', authMiddleware, catalogos)

// ── Empresas ──────────────────────────────────────────────────────────────────
router.get('/empresas',           authMiddleware, listEmpresas)
router.get('/empresas/:id',       authMiddleware, showEmpresa)
router.post('/empresas',          authMiddleware, requireRole('admin'), createEmpresa)
router.put('/empresas/:id',       authMiddleware, updateEmpresa)
router.post('/empresas/:id/servicios', authMiddleware, requireRole('admin'), addServicio)
router.delete('/empresas/:id/servicios/:servicioId', authMiddleware, requireRole('admin'), removeServicio)

// ── Empleados ─────────────────────────────────────────────────────────────────
router.get('/empleados',          authMiddleware, listEmpleados)
router.get('/empleados/:id',      authMiddleware, showEmpleado)
router.post('/empleados',         authMiddleware, createEmpleado)
router.put('/empleados/:id',      authMiddleware, updateEmpleado)
router.delete('/empleados/:id',   authMiddleware, removeEmpleado)
// subrecursos
router.post('/empleados/:id/beneficiarios',          authMiddleware, addBeneficiario)
router.delete('/empleados/:id/beneficiarios/:bid',   authMiddleware, removeBeneficiario)
router.post('/empleados/:id/incapacidades',          authMiddleware, addIncapacidad)
router.put('/empleados/:id/incapacidades/:iid',      authMiddleware, updateIncapacidad)
router.delete('/empleados/:id/incapacidades/:iid',   authMiddleware, removeIncapacidad)

// ── Nominas ──────────────────────────────────────────────────────────────────
router.get('/nominas',            authMiddleware, listNominas)
router.get('/nominas/:id',        authMiddleware, showNomina)
router.post('/nominas',           authMiddleware, requireRole('admin'), createNomina)
router.put('/nominas/:id/liquidar', authMiddleware, requireRole('admin'), liquidarNomina)
router.post('/nominas/:id/planilla', authMiddleware, requireRole('admin'), generarPlanilla)
router.delete('/nominas/:id',     authMiddleware, requireRole('admin'), removeNomina)

// ── Documentos (storage privado + auth) ───────────────────────────────────────
router.get('/documentos',                  authMiddleware, listDocs)
router.post('/documentos',                 authMiddleware, upload.single('file'), uploadDoc)
router.get('/documentos/:id/download',     authMiddleware, download)
router.delete('/documentos/:id',           authMiddleware, removeDoc)

// ── Servicios prestados (viejo detalle_servicios) + catalogo ──────────────────
router.get('/servicios-catalogo',          authMiddleware, listCatalogo)
router.get('/servicio-registros',          authMiddleware, listRegistros)
router.get('/servicio-registros/:id',      authMiddleware, showRegistro)
router.post('/servicio-registros',         authMiddleware, createRegistro)
router.put('/servicio-registros/:id',      authMiddleware, updateRegistro)

// ── Pagos (cuentas de cobro) ──────────────────────────────────────────────────
router.get('/pagos',                       authMiddleware, listPagos)
router.get('/pagos/:id',                   authMiddleware, showPago)
router.post('/pagos',                      authMiddleware, requireRole('admin'), createPago)
router.put('/pagos/:id',                   authMiddleware, requireRole('admin'), updatePago)

// ── Planillas PILA ────────────────────────────────────────────────────────────
router.get('/planillas',                   authMiddleware, listPlanillas)
router.get('/planillas/:id',               authMiddleware, showPlanilla)
router.post('/planillas',                  authMiddleware, requireRole('admin'), createPlanilla)
router.put('/planillas/:id',               authMiddleware, requireRole('admin'), updatePlanilla)

// ── Solicitudes de servicio ───────────────────────────────────────────────────
router.get('/solicitudes',                 authMiddleware, listSolicitudes)
router.post('/solicitudes',                authMiddleware, createSolicitud)
router.put('/solicitudes/:id',             authMiddleware, updateSolicitud)

// ── Soporte ───────────────────────────────────────────────────────────────────
router.get('/soportes',                    authMiddleware, listSoportes)
router.post('/soportes',                   authMiddleware, createSoporte)
router.put('/soportes/:id',                authMiddleware, updateSoporte)

// ── Independientes (personas) ─────────────────────────────────────────────────
router.get('/personas',                    authMiddleware, listPersonas)
router.get('/personas/:id',                authMiddleware, showPersona)
router.post('/personas',                   authMiddleware, requireRole('admin'), createPersona)
router.put('/personas/:id',                authMiddleware, updatePersona)

// ── Gastos (solo admin) ───────────────────────────────────────────────────────
router.get('/gastos',                      authMiddleware, requireRole('admin'), listGastos)
router.post('/gastos',                     authMiddleware, requireRole('admin'), createGasto)
router.put('/gastos/:id',                  authMiddleware, requireRole('admin'), updateGasto)
router.delete('/gastos/:id',               authMiddleware, requireRole('admin'), removeGasto)

// ── Usuarios (solo admin) ─────────────────────────────────────────────────────
router.get('/usuarios',                    authMiddleware, requireRole('admin'), listUsuarios)
router.get('/usuarios/:id',                authMiddleware, requireRole('admin'), showUsuario)
router.put('/usuarios/:id',                authMiddleware, requireRole('admin'), updateUsuario)

// ── Informes (solo admin) ─────────────────────────────────────────────────────
router.get('/informes/resumen',            authMiddleware, requireRole('admin'), resumen)
router.get('/informes/dashboard',          authMiddleware, requireRole('admin'), dashboard)
router.get('/informes/ingresos',           authMiddleware, requireRole('admin'), ingresos)
router.get('/informes/egresos',            authMiddleware, requireRole('admin'), egresos)
router.get('/informes/servicios',          authMiddleware, requireRole('admin'), informeServicios)

export default router
