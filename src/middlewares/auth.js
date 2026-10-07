import jwt from 'jsonwebtoken'
import db from '../db/knex.js'

// Verifica JWT y carga el usuario con su empresa/persona y permisos.
// A diferencia del sistema viejo, req.user SIEMPRE trae el scope:
//   req.user.empresa_id  -> empresa a la que pertenece (null para admin/asesor)
//   req.user.modulos     -> permisos por modulo (obligatorios para 'asesor')
export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' })
  }

  const token = header.slice(7)

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)

    const user = await db('users')
      .select('id', 'name', 'lastname', 'email', 'role', 'is_active', 'terminos_aceptados_en', 'terminos_version')
      .where('id', payload.id)
      .first()

    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' })
    if (!user.is_active) return res.status(403).json({ error: 'Usuario inactivo' })

    // Scope de tenant: empresa o persona (independiente) asociada al usuario
    if (user.role === 'empresa') {
      const empresa = await db('empresas').select('id').where('user_id', user.id).first()
      user.empresa_id = empresa ? empresa.id : null
    } else if (user.role === 'independiente') {
      const persona = await db('personas').select('id').where('user_id', user.id).first()
      user.persona_id = persona ? persona.id : null
    }

    user.modulos = await db('user_modulos').where('user_id', user.id).first() || {}

    req.user = user
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado' })
  }
}

// requireRole('admin') - solo staff de SoyAsesorias
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Sin permiso para esta accion' })
    }
    next()
  }
}

// Staff interno sin scope de cliente: admin (irrestricto) o asesor
// (limitado por user_modulos en la capa de rutas). En los controllers,
// donde antes se comparaba role === 'admin' para decidir "staff vs
// cliente", se usa este helper.
export function esStaff(user) {
  return user.role === 'admin' || user.role === 'asesor'
}

// Gate por modulo segun user_modulos.
//   admin     -> pasa siempre
//   asesor    -> exige el checkbox (staff limitado)
//   empresa / independiente -> si el admin definio checks para el usuario
//   (fila en user_modulos), se respetan; si nunca se configuraron, el
//   cliente conserva su acceso base por compatibilidad.
export function requireModulo(modulo) {
  return (req, res, next) => {
    if (req.user.role === 'admin') return next()
    const modulos = req.user.modulos || {}
    const configurado = Object.keys(modulos).some(k => k !== 'id' && k !== 'user_id' && k !== 'created_at' && k !== 'updated_at')
    if (req.user.role === 'asesor' || configurado) {
      if (!modulos[modulo]) {
        return res.status(403).json({
          error: 'Este modulo no esta habilitado para tu cuenta. Debes solicitar el acceso al administrador.',
          modulo,
          code: 'MODULO_NO_HABILITADO',
        })
      }
    }
    next()
  }
}

// Resuelve el empresa_id efectivo del request.
// - admin: puede operar sobre cualquier empresa (param :empresaId o query)
// - empresa: SIEMPRE forzado a su propia empresa_id (ignora lo que mande el cliente)
export function scopeEmpresa(paramName = 'empresaId') {
  return (req, res, next) => {
    if (req.user.role === 'admin' || req.user.role === 'asesor') {
      const fromParam = req.params[paramName] || req.query.empresa_id || req.body.empresa_id
      req.empresaId = fromParam ? Number(fromParam) : null
      return next()
    }
    if (req.user.role === 'empresa') {
      if (!req.user.empresa_id) {
        return res.status(403).json({ error: 'Usuario sin empresa asociada' })
      }
      req.empresaId = req.user.empresa_id
      return next()
    }
    return res.status(403).json({ error: 'Rol sin acceso a empresas' })
  }
}

// Verifica que un recurso pertenezca a la empresa del usuario (o admin)
export function canAccessEmpresa(user, empresaId) {
  if (user.role === 'admin' || user.role === 'asesor') return true
  return user.empresa_id === Number(empresaId)
}
