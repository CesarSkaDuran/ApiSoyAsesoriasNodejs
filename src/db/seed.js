import 'dotenv/config'
import bcrypt from 'bcryptjs'
import db from './knex.js'

// Seed inicial: catalogos base + usuario admin.
// Los catalogos salen de la BD vieja (valores observados) y de la lista oficial colombiana.

async function seedIfEmpty(table, rows) {
  const count = await db(table).count('* as c').first()
  if (count.c > 0) return false
  await db(table).insert(rows)
  return true
}

export async function runSeed() {
  console.log('Ejecutando seed...')

  // ── Usuario admin ─────────────────────────────────────────────────
  const admin = await db('users').where('email', 'admin@soyasesorias.com').first()
  if (!admin) {
    const [adminId] = await db('users').insert({
      name: 'Admin',
      lastname: 'SoyAsesorias',
      email: 'admin@soyasesorias.com',
      password: bcrypt.hashSync('admin123', 10), // cambiar en produccion
      role: 'admin',
      is_active: true,
    })
    await db('user_modulos').insert({
      user_id: adminId,
      home: true, empresas: true, independientes: true, pagos: true,
      gastos: true, informes: true, soportes: true, solicitudes: true,
      documentos: true, empleados: true, nominas: true, planillas: true,
      servicios: true,
    })
    console.log('  + usuario admin@soyasesorias.com (admin123)')
  }

  // ── Catalogos geograficos ─────────────────────────────────────────
  await seedIfEmpty('departamentos', [
    { nombre: 'Norte de Santander' }, { nombre: 'Antioquia' }, { nombre: 'Cundinamarca' },
    { nombre: 'Valle del Cauca' }, { nombre: 'Atlántico' }, { nombre: 'Santander' },
  ]) && console.log('  + departamentos')

  await seedIfEmpty('ciudades', [
    { departamento_id: 1, nombre: 'Cúcuta' },
    { departamento_id: 1, nombre: 'Los Patios' },
    { departamento_id: 1, nombre: 'Villa del Rosario' },
    { departamento_id: 2, nombre: 'Medellín' },
    { departamento_id: 3, nombre: 'Bogotá' },
    { departamento_id: 4, nombre: 'Cali' },
    { departamento_id: 5, nombre: 'Barranquilla' },
    { departamento_id: 6, nombre: 'Bucaramanga' },
  ]) && console.log('  + ciudades')

  // ── Catalogos comerciales (ventas/leads) ────────────────────────────
  await seedIfEmpty('lead_fuentes', [
    { nombre: 'Instagram' }, { nombre: 'Facebook' }, { nombre: 'WhatsApp' },
    { nombre: 'Web pública' }, { nombre: 'Referido' }, { nombre: 'TikTok' },
    { nombre: 'Llamada' }, { nombre: 'Otro' },
  ]) && console.log('  + lead_fuentes')

  // ── Catalogos de seguridad social ─────────────────────────────────
  await seedIfEmpty('eps', [
    { nombre: 'SURA' }, { nombre: 'Nueva EPS' }, { nombre: 'Sanitas' },
    { nombre: 'Compensar' }, { nombre: 'Famisanar' }, { nombre: 'Salud Total' },
    { nombre: 'Coosalud' }, { nombre: 'Mutual Ser' }, { nombre: 'SOS' },
    { nombre: 'Emssanar' }, { nombre: 'Asmet Salud' }, { nombre: 'Aliansalud' },
  ]) && console.log('  + eps')

  await seedIfEmpty('arl', [
    { nombre: 'SURA' }, { nombre: 'Positiva' }, { nombre: 'Colmena' },
    { nombre: 'AXA Colpatria' }, { nombre: 'Bolívar' }, { nombre: 'Equidad' },
    { nombre: 'Mapfre' }, { nombre: 'Aurora' },
  ]) && console.log('  + arl')

  await seedIfEmpty('pensiones', [
    { nombre: 'Colpensiones' }, { nombre: 'Porvenir' }, { nombre: 'Protección' },
    { nombre: 'Colfondos' }, { nombre: 'Old Mutual' }, { nombre: 'Skandia' },
  ]) && console.log('  + pensiones')

  await seedIfEmpty('cajas_compensacion', [
    { nombre: 'Comfenalco' }, { nombre: 'Comfamiliar' }, { nombre: 'Comfaoriente' },
    { nombre: 'Compensar' }, { nombre: 'Colsubsidio' }, { nombre: 'Cafam' },
    { nombre: 'Cajanal' }, { nombre: 'Comfacundi' },
  ]) && console.log('  + cajas_compensacion')

  await seedIfEmpty('bancos', [
    { nombre: 'Bancolombia' }, { nombre: 'Davivienda' }, { nombre: 'Banco de Bogotá' },
    { nombre: 'BBVA' }, { nombre: 'Banco Popular' }, { nombre: 'Banco de Occidente' },
    { nombre: 'Banco Caja Social' }, { nombre: 'Nequi' }, { nombre: 'Daviplata' },
  ]) && console.log('  + bancos')

  // ── Servicios (mismo catalogo que la BD vieja) ────────────────────
  await seedIfEmpty('servicios', [
    { nombre: 'AFILIACIONES PARA SEGURIDAD SOCIAL', tipo: 'servicio' },
    { nombre: 'CREACION EMPRESA', tipo: 'servicio' },
    { nombre: 'LIQUIDACION Y PAGOS DE PLANILLAS', tipo: 'servicio' },
    { nombre: 'ASESORIAS', tipo: 'servicio' },
    { nombre: 'CONTRATOS', tipo: 'servicio' },
    { nombre: 'INCAPACIDADES', tipo: 'servicio' },
    { nombre: 'EXAMENES OCUPACIONALES', tipo: 'servicio' },
    { nombre: 'SERVICIOS PAGO UNICO', tipo: 'plan', descripcion: 'Asesoría básica S.S / Afiliación S.S / Planilla liq. y pago / Empresa (creación y reg.)' },
    { nombre: 'PLAN EMPRESARIAL SERVICIOS BASICO', tipo: 'plan', descripcion: 'Asesoría básica S.S / Afiliación S.S / Planilla liq. y pago / Empresa (creación y reg.)' },
    { nombre: 'PLAN EMPRESARIAL DE SERVICIOS INTEGRAL', tipo: 'plan', descripcion: 'Básico + Asesoría básica laboral' },
    { nombre: 'PLAN PROFESIONAL', tipo: 'plan', descripcion: 'Integral + Representación laboral' },
    { nombre: 'PLAN EMPRESARIAL SOLO SGSST', tipo: 'plan', descripcion: 'Asesor de riesgos SGSST' },
    { nombre: 'PLAN EMPRESARIAL SGSST BASICO', tipo: 'plan', descripcion: 'SGSST / Afiliaciones, planillas y apoyo administrativo' },
    { nombre: 'SERVICIOS PAGO UNICO EMPLEADOS', tipo: 'plan', descripcion: 'Valor mensual según el número de empleados afiliados a la empresa' },
    { nombre: 'PLAN EMPRESARIAL PYME INTEGRAL', tipo: 'plan', descripcion: 'Afiliaciones / Planillas / Apoyo administrativo / Asesoría jurídica laboral' },
  ]) && console.log('  + servicios')

  console.log('Seed completado.')
}

// Ejecutable directo: npm run seed
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  try {
    await runSeed()
  } catch (err) {
    console.error('Error en seed:', err)
    process.exitCode = 1
  } finally {
    await db.destroy()
  }
}
