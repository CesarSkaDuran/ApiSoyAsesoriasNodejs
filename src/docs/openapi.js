const endpoints = [
  ['Autenticación', 'post', '/api/auth/login', 'Iniciar sesión', { public: true, body: 'LoginRequest' }],
  ['Autenticación', 'post', '/api/auth/refresh', 'Renovar tokens', { public: true, body: 'RefreshTokenRequest' }],
  ['Autenticación', 'get', '/api/auth/terminos', 'Consultar términos vigentes', { public: true }],
  ['Autenticación', 'post', '/api/auth/aceptar-terminos', 'Aceptar términos vigentes', { body: 'AcceptTermsRequest' }],
  ['Autenticación', 'post', '/api/auth/logout', 'Cerrar sesión', { body: 'RefreshTokenRequest' }],
  ['Autenticación', 'get', '/api/auth/me', 'Consultar usuario autenticado'],
  ['Autenticación', 'put', '/api/auth/change-password', 'Cambiar contraseña', { body: 'ChangePasswordRequest' }],
  ['Autenticación', 'post', '/api/auth/users', 'Crear usuario', { body: 'CreateUserRequest' }],
  ['Catálogos', 'get', '/api/catalogos', 'Listar catálogos'],
  ['Empresas', 'get', '/api/empresas', 'Listar empresas'],
  ['Empresas', 'get', '/api/empresas/{id}', 'Consultar empresa'],
  ['Empresas', 'post', '/api/empresas', 'Crear empresa'],
  ['Empresas', 'put', '/api/empresas/{id}', 'Actualizar empresa'],
  ['Empresas', 'post', '/api/empresas/{id}/servicios', 'Asociar servicio a empresa'],
  ['Empresas', 'delete', '/api/empresas/{id}/servicios/{servicioId}', 'Retirar servicio de empresa'],
  ['Empleados', 'get', '/api/empleados', 'Listar empleados'],
  ['Empleados', 'get', '/api/empleados/{id}', 'Consultar empleado'],
  ['Empleados', 'post', '/api/empleados', 'Crear empleado'],
  ['Empleados', 'put', '/api/empleados/{id}', 'Actualizar empleado'],
  ['Empleados', 'delete', '/api/empleados/{id}', 'Eliminar empleado'],
  ['Empleados', 'post', '/api/empleados/{id}/beneficiarios', 'Agregar beneficiario'],
  ['Empleados', 'delete', '/api/empleados/{id}/beneficiarios/{bid}', 'Eliminar beneficiario'],
  ['Empleados', 'post', '/api/empleados/{id}/incapacidades', 'Registrar incapacidad'],
  ['Empleados', 'put', '/api/empleados/{id}/incapacidades/{iid}', 'Actualizar incapacidad'],
  ['Empleados', 'delete', '/api/empleados/{id}/incapacidades/{iid}', 'Eliminar incapacidad'],
  ['Nómina', 'get', '/api/nominas', 'Listar nóminas'],
  ['Nómina', 'post', '/api/nominas', 'Crear nómina'],
  ['Nómina', 'get', '/api/nominas/{id}', 'Consultar nómina'],
  ['Nómina', 'delete', '/api/nominas/{id}', 'Eliminar nómina'],
  ['Nómina', 'get', '/api/nominas/{id}/novedades', 'Consultar novedades de nómina'],
  ['Nómina', 'get', '/api/nominas/{id}/plano', 'Descargar plano de nómina', { download: true }],
  ['Nómina', 'put', '/api/nominas/{id}/liquidar', 'Liquidar nómina'],
  ['Nómina', 'post', '/api/nominas/{id}/planilla', 'Generar planilla'],
  ['Nómina', 'get', '/api/nominas/parametros/{vigencia}', 'Consultar parámetros de nómina'],
  ['Nómina', 'put', '/api/nominas/parametros/{vigencia}', 'Actualizar parámetros de nómina'],
  ['Nómina', 'get', '/api/nominas/conceptos', 'Listar conceptos de nómina'],
  ['Nómina', 'post', '/api/nominas/conceptos', 'Crear concepto de nómina'],
  ['Nómina', 'put', '/api/nominas/conceptos/{id}', 'Actualizar concepto de nómina'],
  ['Nómina', 'get', '/api/nominas/pila-estado', 'Consultar estado PILA'],
  ['Documentos', 'get', '/api/documentos/tipos', 'Listar tipos de documento'],
  ['Documentos', 'get', '/api/documentos', 'Listar documentos'],
  ['Documentos', 'post', '/api/documentos', 'Cargar documento', { multipart: 'file' }],
  ['Documentos', 'put', '/api/documentos/{id}', 'Actualizar documento'],
  ['Documentos', 'get', '/api/documentos/{id}/download', 'Descargar documento', { download: true }],
  ['Documentos', 'delete', '/api/documentos/{id}', 'Eliminar documento'],
  ['Pagos', 'get', '/api/pagos', 'Listar pagos'],
  ['Pagos', 'get', '/api/pagos/{id}', 'Consultar pago'],
  ['Pagos', 'post', '/api/pagos', 'Registrar pago'],
  ['Pagos', 'put', '/api/pagos/{id}', 'Actualizar pago'],
  ['Planillas', 'get', '/api/planillas', 'Listar planillas propias o gestionar todas'],
  ['Planillas', 'get', '/api/planillas/ingresos', 'Consultar ingresos guardados del independiente'],
  ['Planillas', 'get', '/api/planillas/{id}', 'Consultar planilla'],
  ['Planillas', 'post', '/api/planillas', 'Diligenciar planilla independiente o registrar planilla de empresa'],
  ['Planillas', 'put', '/api/planillas/{id}', 'Editar diligenciamiento o actualizar gestión de planilla'],
  ['Solicitudes', 'get', '/api/solicitudes', 'Listar solicitudes'],
  ['Solicitudes', 'get', '/api/solicitudes/{id}', 'Consultar solicitud'],
  ['Solicitudes', 'post', '/api/solicitudes', 'Crear solicitud'],
  ['Solicitudes', 'put', '/api/solicitudes/{id}', 'Actualizar solicitud'],
  ['Solicitudes', 'put', '/api/solicitudes/{id}/respuesta', 'Cargar respuesta a solicitud', { multipart: 'file' }],
  ['Solicitudes', 'get', '/api/solicitudes/{id}/respuesta', 'Descargar respuesta de solicitud', { download: true }],
  ['Solicitudes', 'delete', '/api/solicitudes/{id}/respuesta', 'Eliminar respuesta de solicitud'],
  ['Notificaciones', 'get', '/api/notificaciones', 'Listar notificaciones'],
  ['Notificaciones', 'put', '/api/notificaciones/leidas', 'Marcar todas como leídas'],
  ['Notificaciones', 'put', '/api/notificaciones/{id}/leida', 'Marcar notificación como leída'],
  ['Soportes', 'get', '/api/soportes', 'Listar soportes'],
  ['Soportes', 'get', '/api/soportes/{id}', 'Consultar soporte'],
  ['Soportes', 'post', '/api/soportes', 'Crear soporte'],
  ['Soportes', 'put', '/api/soportes/{id}', 'Actualizar soporte'],
  ['Personas', 'get', '/api/personas', 'Listar personas independientes'],
  ['Personas', 'get', '/api/personas/{id}', 'Consultar persona independiente'],
  ['Personas', 'post', '/api/personas', 'Crear persona independiente'],
  ['Personas', 'put', '/api/personas/{id}', 'Actualizar persona independiente'],
  ['Gastos', 'get', '/api/gastos', 'Listar gastos'],
  ['Gastos', 'get', '/api/gastos/{id}', 'Consultar gasto'],
  ['Gastos', 'post', '/api/gastos', 'Crear gasto'],
  ['Gastos', 'put', '/api/gastos/{id}', 'Actualizar gasto'],
  ['Gastos', 'delete', '/api/gastos/{id}', 'Eliminar gasto'],
  ['Usuarios', 'get', '/api/usuarios', 'Listar usuarios'],
  ['Usuarios', 'get', '/api/usuarios/{id}', 'Consultar usuario'],
  ['Usuarios', 'put', '/api/usuarios/{id}/password', 'Restablecer contraseña de usuario'],
  ['Usuarios', 'put', '/api/usuarios/{id}', 'Actualizar usuario'],
  ['Informes', 'get', '/api/informes/mi-resumen', 'Consultar resumen del usuario'],
  ['Informes', 'get', '/api/informes/resumen', 'Consultar resumen general'],
  ['Informes', 'get', '/api/informes/dashboard', 'Consultar datos del dashboard'],
  ['Informes', 'get', '/api/informes/ingresos', 'Consultar informe de ingresos'],
  ['Informes', 'get', '/api/informes/egresos', 'Consultar informe de egresos'],
  ['Informes', 'get', '/api/informes/servicios', 'Consultar informe de servicios'],
  ['Auditoría', 'get', '/api/auditorias', 'Consultar registros de auditoría'],
  ['Maestros', 'get', '/api/maestros', 'Listar catálogos maestros'],
  ['Maestros', 'get', '/api/maestros/{catalogo}', 'Consultar registros de catálogo'],
  ['Maestros', 'post', '/api/maestros/{catalogo}', 'Crear registro de catálogo'],
  ['Maestros', 'put', '/api/maestros/{catalogo}/{id}', 'Actualizar registro de catálogo'],
  ['Maestros', 'delete', '/api/maestros/{catalogo}/{id}', 'Eliminar registro de catálogo'],
  ['Ventas', 'post', '/api/ventas/ingest', 'Recibir lead de captación', { apiKey: true }],
  ['Ventas', 'get', '/api/ventas', 'Consultar embudos y leads'],
  ['Ventas', 'get', '/api/ventas/embudo/{slug}', 'Consultar etapas de embudo'],
  ['Ventas', 'post', '/api/ventas/embudos', 'Crear embudo'],
  ['Ventas', 'put', '/api/ventas/embudos/{id}', 'Actualizar embudo'],
  ['Ventas', 'post', '/api/ventas/embudos/{id}/etapas', 'Crear etapa de embudo'],
  ['Ventas', 'put', '/api/ventas/etapas/{id}', 'Actualizar etapa'],
  ['Ventas', 'delete', '/api/ventas/etapas/{id}', 'Eliminar etapa'],
  ['Ventas', 'get', '/api/ventas/leads/{id}', 'Consultar lead'],
  ['Ventas', 'post', '/api/ventas/leads', 'Crear lead'],
  ['Ventas', 'put', '/api/ventas/leads/{id}', 'Actualizar lead'],
  ['Ventas', 'put', '/api/ventas/leads/{id}/etapa', 'Mover lead de etapa'],
  ['Ventas', 'post', '/api/ventas/leads/{id}/convertir', 'Convertir lead en cliente'],
  ['Ventas', 'delete', '/api/ventas/leads/{id}', 'Eliminar lead'],
  ['Servicios', 'get', '/api/servicios-catalogo', 'Consultar catálogo de servicios'],
  ['Servicios', 'get', '/api/servicio-registros', 'Listar registros de servicio'],
  ['Servicios', 'get', '/api/servicio-registros/{id}', 'Consultar registro de servicio'],
  ['Servicios', 'post', '/api/servicio-registros', 'Crear registro de servicio'],
  ['Servicios', 'put', '/api/servicio-registros/{id}', 'Actualizar registro de servicio'],
  ['Diagnósticos', 'get', '/api/diagnosticos', 'Listar diagnósticos'],
  ['Diagnósticos', 'post', '/api/diagnosticos', 'Crear diagnóstico'],
  ['Diagnósticos', 'get', '/api/diagnosticos/{id}', 'Consultar diagnóstico'],
  ['Diagnósticos', 'put', '/api/diagnosticos/{id}', 'Actualizar diagnóstico'],
  ['Diagnósticos', 'put', '/api/diagnosticos/{id}/estado', 'Cambiar estado del diagnóstico'],
  ['Diagnósticos', 'delete', '/api/diagnosticos/{id}', 'Eliminar diagnóstico'],
  ['Diagnósticos', 'get', '/api/diagnosticos/{id}/entrevista', 'Consultar entrevista del diagnóstico'],
  ['Diagnósticos', 'put', '/api/diagnosticos/{id}/respuestas', 'Guardar respuestas de entrevista'],
  ['Diagnósticos', 'get', '/api/diagnosticos/{id}/documentos', 'Listar documentos del diagnóstico'],
  ['Diagnósticos', 'post', '/api/diagnosticos/{id}/documentos/{configId}', 'Cargar documento del diagnóstico', { multipart: 'archivo' }],
  ['Diagnósticos', 'get', '/api/diagnosticos/documentos/{docId}/download', 'Descargar documento de diagnóstico', { download: true }],
  ['Diagnósticos', 'put', '/api/diagnosticos/documentos/{docId}', 'Revisar documento de diagnóstico'],
  ['Diagnósticos', 'get', '/api/diagnosticos/{id}/informe', 'Consultar informe de diagnóstico'],
  ['Diagnósticos', 'put', '/api/diagnosticos/{id}/informe', 'Guardar informe de diagnóstico'],
  ['Diagnósticos', 'get', '/api/diagnostico-config/preguntas', 'Listar preguntas de diagnóstico'],
  ['Diagnósticos', 'post', '/api/diagnostico-config/preguntas', 'Crear pregunta de diagnóstico'],
  ['Diagnósticos', 'put', '/api/diagnostico-config/preguntas/{id}', 'Actualizar pregunta de diagnóstico'],
  ['Diagnósticos', 'delete', '/api/diagnostico-config/preguntas/{id}', 'Eliminar pregunta de diagnóstico'],
  ['Diagnósticos', 'get', '/api/diagnostico-config/documentos', 'Listar configuraciones de documentos'],
  ['Diagnósticos', 'post', '/api/diagnostico-config/documentos', 'Crear configuración de documento'],
  ['Diagnósticos', 'put', '/api/diagnostico-config/documentos/{id}', 'Actualizar configuración de documento'],
  ['Diagnósticos', 'delete', '/api/diagnostico-config/documentos/{id}', 'Eliminar configuración de documento'],
  ['Configuración', 'get', '/api/configuracion/correo', 'Consultar configuración de correo'],
  ['Configuración', 'put', '/api/configuracion/correo', 'Actualizar configuración de correo'],
  ['Configuración', 'post', '/api/configuracion/correo/probar', 'Probar configuración de correo'],
  ['Sistema', 'get', '/health', 'Verificar estado de la API', { public: true }],
]

const schemas = {
  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'usuario@empresa.com' },
      password: { type: 'string', format: 'password' },
    },
  },
  RefreshTokenRequest: {
    type: 'object',
    required: ['refresh_token'],
    properties: { refresh_token: { type: 'string' } },
  },
  AcceptTermsRequest: {
    type: 'object',
    required: ['version'],
    properties: { version: { type: 'string', description: 'Versión vigente obtenida desde GET /api/auth/terminos.' } },
  },
  ChangePasswordRequest: {
    type: 'object',
    required: ['current_password', 'new_password'],
    properties: {
      current_password: { type: 'string', format: 'password' },
      new_password: { type: 'string', format: 'password', minLength: 8, maxLength: 72 },
    },
  },
  CreateUserRequest: {
    type: 'object',
    required: ['name', 'email', 'password', 'role'],
    properties: {
      name: { type: 'string' },
      lastname: { type: 'string' },
      email: { type: 'string', format: 'email' },
      password: { type: 'string', format: 'password', minLength: 8 },
      role: { type: 'string', enum: ['admin', 'empresa', 'independiente'] },
      empresa_id: { type: 'integer' },
      persona_id: { type: 'integer' },
      modulos: { type: 'object', additionalProperties: { type: 'boolean' } },
    },
  },
}

const genericObject = { type: 'object', additionalProperties: true }
const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } },
}

function operationId(method, path) {
  return `${method}_${path}`.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function buildOperation([tag, method, path, summary, options = {}]) {
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: ['slug', 'catalogo', 'vigencia'].includes(name) ? 'string' : 'integer' },
  }))
  const responses = {
    200: { description: 'Solicitud procesada correctamente.' },
    400: { description: 'Solicitud inválida.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    401: { description: 'Autenticación requerida o token inválido.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    403: { description: 'El usuario no tiene permisos para esta operación.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    404: { description: 'Recurso no encontrado.' },
    500: { description: 'Error interno del servidor.' },
  }
  if (method === 'post') responses[201] = { description: 'Recurso creado.' }
  if (method === 'post' || method === 'put') {
    const requestSchema = options.body ? { $ref: `#/components/schemas/${options.body}` } : genericObject
    const contentType = options.multipart ? 'multipart/form-data' : 'application/json'
    const properties = options.multipart ? { [options.multipart]: { type: 'string', format: 'binary' } } : undefined
    return {
      tags: [tag],
      summary,
      operationId: operationId(method, path),
      ...(parameters.length ? { parameters } : {}),
      requestBody: {
        required: true,
        content: {
          [contentType]: { schema: properties ? { type: 'object', properties } : requestSchema },
        },
      },
      responses,
      ...(options.public ? { security: [] } : options.apiKey ? { security: [{ marketingToken: [] }] } : {}),
    }
  }
  return {
    tags: [tag],
    summary,
    operationId: operationId(method, path),
    ...(parameters.length ? { parameters } : {}),
    responses: options.download
      ? { ...responses, 200: { description: 'Archivo descargable.', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } } }
      : responses,
    ...(options.public ? { security: [] } : options.apiKey ? { security: [{ marketingToken: [] }] } : {}),
  }
}

const paths = {}
for (const endpoint of endpoints) {
  const [, method, path] = endpoint
  paths[path] ??= {}
  paths[path][method] = buildOperation(endpoint)
}

const tags = [...new Set(endpoints.map(([tag]) => tag))].map((name) => ({ name }))

export default {
  openapi: '3.0.3',
  info: {
    title: 'API SoyAsesorías',
    version: '1.0.0',
    description: 'Documentación interactiva de la API de SoyAsesorías. Los endpoints protegidos requieren un token Bearer obtenido desde /api/auth/login.',
  },
  servers: [{ url: '/', description: 'Servidor actual' }],
  tags,
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      marketingToken: { type: 'apiKey', in: 'header', name: 'x-marketing-token' },
    },
    schemas: {
      ...schemas,
      Error: errorSchema,
    },
  },
  security: [{ bearerAuth: [] }],
}
