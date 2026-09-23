import db from './knex.js'

// Schema nuevo para SoyAsesorias.
// InnoDB + FKs reales + indices. Montos DECIMAL, fechas DATE/DATETIME.
// El tenant real es empresa_id (se acaba la indireccion por afiliacion_id).

export async function runMigrations() {
  console.log('Ejecutando migraciones...')

  // ══════════════════════════════════════════════════════════════════
  // CATALOGOS
  // ══════════════════════════════════════════════════════════════════

  if (!await db.schema.hasTable('departamentos')) {
    await db.schema.createTable('departamentos', t => {
      t.increments('id')
      t.string('nombre', 100).notNullable()
      t.timestamps(true, true)
    })
    console.log('  + departamentos')
  }

  if (!await db.schema.hasTable('ciudades')) {
    await db.schema.createTable('ciudades', t => {
      t.increments('id')
      t.integer('departamento_id').unsigned().references('id').inTable('departamentos').index()
      t.string('nombre', 150).notNullable()
      t.timestamps(true, true)
    })
    console.log('  + ciudades')
  }

  if (!await db.schema.hasTable('actividades_economicas')) {
    await db.schema.createTable('actividades_economicas', t => {
      t.increments('id')
      t.string('codigo', 20).nullable()
      t.string('nombre', 255).notNullable()
      t.timestamps(true, true)
    })
    console.log('  + actividades_economicas')
  }

  if (!await db.schema.hasTable('eps')) {
    await db.schema.createTable('eps', t => {
      t.increments('id')
      t.string('nombre', 150).notNullable()
      t.boolean('activo').defaultTo(true)
      t.timestamps(true, true)
    })
    console.log('  + eps')
  }

  if (!await db.schema.hasTable('arl')) {
    await db.schema.createTable('arl', t => {
      t.increments('id')
      t.string('nombre', 150).notNullable()
      t.boolean('activo').defaultTo(true)
      t.timestamps(true, true)
    })
    console.log('  + arl')
  }

  if (!await db.schema.hasTable('pensiones')) {
    await db.schema.createTable('pensiones', t => {
      t.increments('id')
      t.string('nombre', 150).notNullable()
      t.boolean('activo').defaultTo(true)
      t.timestamps(true, true)
    })
    console.log('  + pensiones')
  }

  if (!await db.schema.hasTable('cajas_compensacion')) {
    await db.schema.createTable('cajas_compensacion', t => {
      t.increments('id')
      t.string('nombre', 150).notNullable()
      t.boolean('activo').defaultTo(true)
      t.timestamps(true, true)
    })
    console.log('  + cajas_compensacion')
  }

  if (!await db.schema.hasTable('bancos')) {
    await db.schema.createTable('bancos', t => {
      t.increments('id')
      t.string('nombre', 150).notNullable()
      t.boolean('activo').defaultTo(true)
      t.timestamps(true, true)
    })
    console.log('  + bancos')
  }

  if (!await db.schema.hasTable('cargos')) {
    await db.schema.createTable('cargos', t => {
      t.increments('id')
      t.string('nombre', 150).notNullable()
      t.timestamps(true, true)
    })
    console.log('  + cargos')
  }

  // Catalogo de servicios que vende SoyAsesorias (afiliaciones, planillas, planes...)
  if (!await db.schema.hasTable('servicios')) {
    await db.schema.createTable('servicios', t => {
      t.increments('id')
      t.string('nombre', 200).notNullable()
      t.text('descripcion').nullable()
      t.enum('tipo', ['servicio', 'plan']).defaultTo('servicio')
      t.decimal('valor', 15, 2).nullable()
      t.boolean('activo').defaultTo(true)
      t.timestamps(true, true)
    })
    console.log('  + servicios')
  }

  // ══════════════════════════════════════════════════════════════════
  // USUARIOS Y PERMISOS
  // ══════════════════════════════════════════════════════════════════

  if (!await db.schema.hasTable('users')) {
    await db.schema.createTable('users', t => {
      t.increments('id')
      t.string('name', 150).notNullable()
      t.string('lastname', 150).nullable()
      t.string('email', 191).notNullable().unique()
      t.string('password', 255).notNullable()
      t.enum('role', ['admin', 'empresa', 'independiente']).defaultTo('empresa')
      t.boolean('is_active').defaultTo(true)
      t.timestamp('last_seen_at').nullable()
      t.timestamps(true, true)
    })
    console.log('  + users')
  }

  // Permisos por modulo (reemplaza tabla modulos: 1=si, 0/2=no segun regla de negocio)
  if (!await db.schema.hasTable('user_modulos')) {
    await db.schema.createTable('user_modulos', t => {
      t.increments('id')
      t.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE').notNullable().index()
      t.boolean('home').defaultTo(true)
      t.boolean('empresas').defaultTo(false)
      t.boolean('independientes').defaultTo(false)
      t.boolean('pagos').defaultTo(false)
      t.boolean('gastos').defaultTo(false)
      t.boolean('informes').defaultTo(false)
      t.boolean('soportes').defaultTo(false)
      t.boolean('solicitudes').defaultTo(false)
      t.boolean('documentos').defaultTo(false)
      t.boolean('empleados').defaultTo(false)
      t.boolean('nominas').defaultTo(false)
      t.boolean('planillas').defaultTo(false)
      t.boolean('servicios').defaultTo(false)
      t.timestamps(true, true)
      t.unique(['user_id'])
    })
    console.log('  + user_modulos')
  }

  // ══════════════════════════════════════════════════════════════════
  // CLIENTES: EMPRESAS E INDEPENDIENTES
  // ══════════════════════════════════════════════════════════════════

  if (!await db.schema.hasTable('empresas')) {
    await db.schema.createTable('empresas', t => {
      t.increments('id')
      t.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable().index()
      t.integer('actividad_economica_id').unsigned().references('id').inTable('actividades_economicas').nullable()
      t.integer('departamento_id').unsigned().references('id').inTable('departamentos').nullable()
      t.integer('ciudad_id').unsigned().references('id').inTable('ciudades').nullable()
      t.integer('caja_compensacion_id').unsigned().references('id').inTable('cajas_compensacion').nullable()
      t.string('razon_social', 255).notNullable()
      t.enum('tipo_documento', ['NIT', 'CC', 'CE', 'PAS', 'OTRO']).defaultTo('NIT')
      t.string('num_documento', 50).nullable().index()
      t.string('dv', 5).nullable()
      t.enum('tipo_empresa', ['natural', 'juridica']).defaultTo('juridica')
      t.string('direccion', 255).nullable()
      t.string('telefono_fijo', 50).nullable()
      t.string('telefono_movil', 50).nullable()
      t.string('email', 191).nullable()
      t.string('email_contacto', 191).nullable()
      t.string('representante_legal', 255).nullable()
      t.string('nombre_contacto', 255).nullable()
      t.string('telefono_contacto', 50).nullable()
      t.string('imagen', 255).nullable()
      t.integer('num_empleados').nullable()
      t.enum('riesgo', ['I', 'II', 'III', 'IV', 'V']).nullable()
      t.decimal('valor_empleado', 15, 2).nullable()
      t.decimal('iva', 5, 2).nullable()
      t.date('fecha_registro').nullable()
      t.enum('status', ['prospecto', 'activo', 'inactivo']).defaultTo('prospecto')
      t.text('observaciones').nullable()
      t.string('email_responsable', 191).nullable()
      t.string('telefono_responsable', 50).nullable()
      t.string('exonerado_parafiscales', 5).nullable()
      // IDs en la BD vieja, para trazabilidad de la migracion
      t.integer('legacy_id').nullable().index()
      t.integer('legacy_afiliacion_id').nullable().index()
      t.timestamps(true, true)
    })
    console.log('  + empresas')
  } else {
    // add columns if missing
    if (!await db.schema.hasColumn('empresas', 'email_responsable')) {
      await db.schema.alterTable('empresas', t => {
        t.string('email_responsable', 191).nullable()
        t.string('telefono_responsable', 50).nullable()
        t.string('exonerado_parafiscales', 5).nullable()
      })
    }
  }

  // Trabajadores independientes (persona natural cliente)
  if (!await db.schema.hasTable('personas')) {
    await db.schema.createTable('personas', t => {
      t.increments('id')
      t.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable().index()
      t.integer('departamento_id').unsigned().references('id').inTable('departamentos').nullable()
      t.integer('ciudad_id').unsigned().references('id').inTable('ciudades').nullable()
      t.string('primer_nombre', 100).notNullable()
      t.string('segundo_nombre', 100).nullable()
      t.string('primer_apellido', 100).nullable()
      t.string('segundo_apellido', 100).nullable()
      t.enum('tipo_documento', ['CC', 'CE', 'PAS', 'NIT', 'OTRO']).defaultTo('CC')
      t.string('num_documento', 50).nullable().index()
      t.string('direccion', 255).nullable()
      t.string('telefono', 50).nullable()
      t.string('email', 191).nullable()
      t.string('imagen', 255).nullable()
      t.enum('tipo_afiliacion', ['independiente', 'empleado', 'otro']).nullable()
      t.text('observaciones').nullable()
      t.enum('status', ['prospecto', 'activo', 'inactivo']).defaultTo('prospecto')
      t.integer('legacy_id').nullable().index()
      t.integer('legacy_afiliacion_id').nullable().index()
      t.timestamps(true, true)
    })
    console.log('  + personas')
  }

  if (!await db.schema.hasTable('sucursales')) {
    await db.schema.createTable('sucursales', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').notNullable().index()
      t.string('nombre', 150).notNullable()
      t.string('direccion', 255).nullable()
      t.integer('ciudad_id').unsigned().references('id').inTable('ciudades').nullable()
      t.timestamps(true, true)
    })
    console.log('  + sucursales')
  }

  // Servicios contratados por cada empresa (reemplaza las ~14 columnas varchar de flags)
  if (!await db.schema.hasTable('empresa_servicios')) {
    await db.schema.createTable('empresa_servicios', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').notNullable()
      t.integer('servicio_id').unsigned().references('id').inTable('servicios').notNullable()
      t.date('fecha_inicio').nullable()
      t.date('fecha_fin').nullable()
      t.decimal('valor', 15, 2).nullable()
      t.enum('status', ['solicitado', 'en_proceso', 'activo', 'finalizado', 'cancelado']).defaultTo('solicitado')
      t.timestamps(true, true)
      t.unique(['empresa_id', 'servicio_id'])
      t.index(['empresa_id'])
    })
    console.log('  + empresa_servicios')
  }

  // Solicitud/registro de afiliacion (historico, ya no es la llave del tenant)
  if (!await db.schema.hasTable('afiliaciones')) {
    await db.schema.createTable('afiliaciones', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').nullable().index()
      t.integer('persona_id').unsigned().references('id').inTable('personas').nullable().index()
      t.integer('servicio_id').unsigned().references('id').inTable('servicios').nullable()
      t.enum('tipo', ['empresa', 'independiente']).notNullable()
      t.string('progreso', 50).nullable()
      t.date('fecha_solicitud').nullable()
      t.enum('status', ['pendiente', 'en_proceso', 'completada', 'rechazada']).defaultTo('pendiente')
      t.text('observaciones').nullable()
      t.integer('legacy_id').nullable().index() // id en soyaseso_bd.afiliaciones
      t.timestamps(true, true)
    })
    console.log('  + afiliaciones')
  }

  // ══════════════════════════════════════════════════════════════════
  // EMPLEADOS Y NOMINA
  // ══════════════════════════════════════════════════════════════════

  if (!await db.schema.hasTable('empleados')) {
    await db.schema.createTable('empleados', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').notNullable().index()
      t.integer('sucursal_id').unsigned().references('id').inTable('sucursales').onDelete('SET NULL').nullable()
      t.integer('cargo_id').unsigned().references('id').inTable('cargos').onDelete('SET NULL').nullable()
      t.integer('eps_id').unsigned().references('id').inTable('eps').onDelete('SET NULL').nullable()
      t.integer('arl_id').unsigned().references('id').inTable('arl').onDelete('SET NULL').nullable()
      t.integer('pension_id').unsigned().references('id').inTable('pensiones').onDelete('SET NULL').nullable()
      t.integer('caja_cf_id').unsigned().references('id').inTable('cajas_compensacion').onDelete('SET NULL').nullable()
      t.integer('ciudad_id').unsigned().references('id').inTable('ciudades').nullable()
      t.string('primer_nombre', 100).notNullable()
      t.string('segundo_nombre', 100).nullable()
      t.string('primer_apellido', 100).nullable()
      t.string('segundo_apellido', 100).nullable()
      t.enum('tipo_documento', ['CC', 'CE', 'PAS', 'OTRO']).defaultTo('CC')
      t.string('numero_documento', 50).notNullable()
      t.string('direccion', 255).nullable()
      t.string('movil', 50).nullable()
      t.string('email', 191).nullable()
      t.date('fecha_ingreso').nullable()
      t.date('fecha_retiro').nullable()
      t.decimal('salario_base', 15, 2).defaultTo(0)
      t.boolean('subsidio_transporte').defaultTo(false)
      t.enum('tipo_contrato', ['indefinido', 'fijo', 'obra_labor', 'prestacion', 'aprendizaje', 'otro']).nullable()
      t.enum('periodo_pago', ['mensual', 'quincenal', 'semanal']).defaultTo('mensual')
      t.enum('riesgo', ['I', 'II', 'III', 'IV', 'V']).nullable()
      t.enum('tipo_vinculacion', ['directa', 'temporal', 'otra']).nullable()
      t.text('observaciones').nullable()
      t.enum('status', ['activo', 'retirado', 'suspendido']).defaultTo('activo')
      t.integer('legacy_id').nullable().index()
      t.timestamps(true, true)
      t.unique(['empresa_id', 'numero_documento'])
    })
    console.log('  + empleados')
  }

  if (!await db.schema.hasTable('beneficiados')) {
    await db.schema.createTable('beneficiados', t => {
      t.increments('id')
      t.integer('empleado_id').unsigned().references('id').inTable('empleados').onDelete('CASCADE').notNullable().index()
      t.string('nombre', 200).notNullable()
      t.string('parentesco', 50).nullable()
      t.string('num_documento', 50).nullable()
      t.date('fecha_nacimiento').nullable()
      t.timestamps(true, true)
    })
    console.log('  + beneficiados')
  }

  if (!await db.schema.hasTable('periodos')) {
    await db.schema.createTable('periodos', t => {
      t.increments('id')
      t.string('nombre', 100).notNullable()
      t.date('fecha_inicio').notNullable()
      t.date('fecha_fin').notNullable()
      t.timestamps(true, true)
    })
    console.log('  + periodos')
  }

  if (!await db.schema.hasTable('nominas')) {
    await db.schema.createTable('nominas', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').notNullable().index()
      t.integer('periodo_id').unsigned().references('id').inTable('periodos').nullable()
      t.string('nombre_periodo', 100).nullable()
      t.integer('num_empleados').defaultTo(0)
      t.decimal('valor_total', 15, 2).defaultTo(0)
      t.decimal('total_seguridad_social', 15, 2).defaultTo(0)
      t.decimal('total_horas_extras', 15, 2).defaultTo(0)
      t.decimal('total_otros_pagos', 15, 2).defaultTo(0)
      t.decimal('total_deducciones', 15, 2).defaultTo(0)
      t.enum('status', ['borrador', 'liquidada', 'pagada']).defaultTo('borrador')
      t.timestamps(true, true)
    })
    console.log('  + nominas')
  }

  // Detalle por empleado: devengados + aportes seguridad social (PILA) + prestaciones
  if (!await db.schema.hasTable('nomina_detalles')) {
    await db.schema.createTable('nomina_detalles', t => {
      t.increments('id')
      t.integer('nomina_id').unsigned().references('id').inTable('nominas').onDelete('CASCADE').notNullable().index()
      t.integer('empleado_id').unsigned().references('id').inTable('empleados').notNullable()
      t.decimal('dias_laborados', 5, 1).defaultTo(0)
      t.decimal('salario_base', 15, 2).defaultTo(0)
      t.decimal('aux_transporte', 15, 2).defaultTo(0)
      t.decimal('horas_extras', 15, 2).defaultTo(0)
      t.decimal('otros_ingresos', 15, 2).defaultTo(0)
      t.decimal('ingreso_noc', 15, 2).defaultTo(0)
      t.decimal('deducciones', 15, 2).defaultTo(0)
      // Seguridad social / planilla
      t.decimal('ibc', 15, 2).defaultTo(0)
      t.decimal('ibl', 15, 2).nullable()
      t.decimal('salud', 15, 2).defaultTo(0)
      t.decimal('pension', 15, 2).defaultTo(0)
      t.decimal('arl', 15, 2).defaultTo(0)
      t.decimal('ccf', 15, 2).defaultTo(0)
      t.decimal('sena', 15, 2).defaultTo(0)
      t.decimal('icbf', 15, 2).defaultTo(0)
      t.decimal('riesgo', 15, 2).defaultTo(0)
      // Prestaciones sociales
      t.decimal('cesantias', 15, 2).defaultTo(0)
      t.decimal('intereses', 15, 2).defaultTo(0)
      t.decimal('vacaciones', 15, 2).defaultTo(0)
      t.decimal('indemnizacion', 15, 2).defaultTo(0)
      // Totales
      t.decimal('total_nomina', 15, 2).defaultTo(0)
      t.decimal('total_planilla', 15, 2).defaultTo(0)
      t.decimal('neto', 15, 2).defaultTo(0)
      t.timestamps(true, true)
      t.unique(['nomina_id', 'empleado_id'])
    })
    console.log('  + nomina_detalles')
  }

  if (!await db.schema.hasTable('horas_extras')) {
    await db.schema.createTable('horas_extras', t => {
      t.increments('id')
      t.integer('empleado_id').unsigned().references('id').inTable('empleados').onDelete('CASCADE').notNullable().index()
      t.integer('nomina_id').unsigned().references('id').inTable('nominas').onDelete('SET NULL').nullable()
      t.date('fecha').nullable()
      t.decimal('cantidad', 6, 2).notNullable()
      t.enum('tipo', ['diurna', 'nocturna', 'dominical', 'festiva', 'recargo_nocturno']).defaultTo('diurna')
      t.decimal('valor', 15, 2).defaultTo(0)
      t.timestamps(true, true)
    })
    console.log('  + horas_extras')
  }

  if (!await db.schema.hasTable('otros_ingresos')) {
    await db.schema.createTable('otros_ingresos', t => {
      t.increments('id')
      t.integer('empleado_id').unsigned().references('id').inTable('empleados').onDelete('CASCADE').notNullable().index()
      t.integer('nomina_id').unsigned().references('id').inTable('nominas').onDelete('SET NULL').nullable()
      t.string('concepto', 200).notNullable()
      t.decimal('valor', 15, 2).notNullable()
      t.date('fecha').nullable()
      t.timestamps(true, true)
    })
    console.log('  + otros_ingresos')
  }

  if (!await db.schema.hasTable('deducciones')) {
    await db.schema.createTable('deducciones', t => {
      t.increments('id')
      t.integer('empleado_id').unsigned().references('id').inTable('empleados').onDelete('CASCADE').notNullable().index()
      t.integer('nomina_id').unsigned().references('id').inTable('nominas').onDelete('SET NULL').nullable()
      t.string('concepto', 200).notNullable()
      t.decimal('valor', 15, 2).notNullable()
      t.date('fecha').nullable()
      t.timestamps(true, true)
    })
    console.log('  + deducciones')
  }

  if (!await db.schema.hasTable('incapacidades')) {
    await db.schema.createTable('incapacidades', t => {
      t.increments('id')
      t.integer('empleado_id').unsigned().references('id').inTable('empleados').onDelete('CASCADE').notNullable().index()
      t.integer('eps_id').unsigned().references('id').inTable('eps').onDelete('SET NULL').nullable()
      t.date('fecha_inicio').notNullable()
      t.date('fecha_fin').nullable()
      t.integer('dias').nullable()
      t.enum('tipo', ['comun', 'laboral', 'maternidad', 'otra']).defaultTo('comun')
      t.decimal('valor', 15, 2).nullable()
      t.enum('status', ['reportada', 'en_tramite', 'pagada']).defaultTo('reportada')
      t.timestamps(true, true)
    })
    console.log('  + incapacidades')
  }

  // Planillas PILA de seguridad social
  if (!await db.schema.hasTable('planillas')) {
    await db.schema.createTable('planillas', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').notNullable().index()
      t.integer('nomina_id').unsigned().references('id').inTable('nominas').onDelete('SET NULL').nullable()
      t.string('numero_planilla', 100).nullable()
      t.string('periodo', 20).nullable()
      t.decimal('valor_total', 15, 2).defaultTo(0)
      t.date('fecha_pago').nullable()
      t.enum('status', ['generada', 'pagada', 'verificada']).defaultTo('generada')
      t.timestamps(true, true)
    })
    console.log('  + planillas')
  }

  // ══════════════════════════════════════════════════════════════════
  // FACTURACION AL CLIENTE (cuentas de cobro) Y GASTOS
  // ══════════════════════════════════════════════════════════════════

  if (!await db.schema.hasTable('cuentas_cobro')) {
    await db.schema.createTable('cuentas_cobro', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').nullable().index()
      t.integer('persona_id').unsigned().references('id').inTable('personas').nullable().index()
      t.string('numero', 50).nullable()
      t.date('fecha').nullable()
      t.decimal('valor_total', 15, 2).defaultTo(0)
      t.enum('status', ['pendiente', 'pagada', 'anulada']).defaultTo('pendiente')
      t.timestamps(true, true)
    })
    console.log('  + cuentas_cobro')
  }

  if (!await db.schema.hasTable('detalle_cobro')) {
    await db.schema.createTable('detalle_cobro', t => {
      t.increments('id')
      t.integer('cuenta_cobro_id').unsigned().references('id').inTable('cuentas_cobro').onDelete('CASCADE').notNullable().index()
      t.integer('servicio_id').unsigned().references('id').inTable('servicios').nullable()
      t.string('descripcion', 255).nullable()
      t.integer('cantidad').defaultTo(1)
      t.decimal('valor', 15, 2).defaultTo(0)
      t.timestamps(true, true)
    })
    console.log('  + detalle_cobro')
  }

  // Registros de servicios prestados (viejo detalle_servicios: afiliaciones,
  // incapacidades, asesorias... por empresa/persona con estado y estado pago).
  // status: 1=Pendiente 2=Finalizado 3=Verificado 4=En tramite 5=Cancelado
  // status_pago: 1=Pagado 2=Pendiente 3=Cancelado
  if (!await db.schema.hasTable('servicio_registros')) {
    await db.schema.createTable('servicio_registros', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').nullable().index()
      t.integer('persona_id').unsigned().references('id').inTable('personas').onDelete('CASCADE').nullable().index()
      t.integer('empleado_id').unsigned().references('id').inTable('empleados').onDelete('SET NULL').nullable().index()
      t.integer('servicio_id').unsigned().references('id').inTable('servicios').nullable()
      t.string('nombre', 200).nullable()           // categoria: AFILIACIONES PARA SEGURIDAD SOCIAL, ASESORIAS...
      t.integer('tipo').nullable()                // 1=servicio 2=plan (viejo detalle_servicios.tipo)
      t.date('fecha').nullable()
      t.integer('cantidad').defaultTo(1)
      t.decimal('valor', 15, 2).nullable()
      t.string('paquete', 255).nullable()
      t.string('unidad', 20).nullable()
      t.integer('numero_empleados').defaultTo(0)
      t.text('obs').nullable()
      t.tinyint('status').defaultTo(1)
      t.tinyint('status_pago').defaultTo(2)
      t.integer('legacy_id').nullable().index()
      t.timestamps(true, true)
      t.index(['empresa_id', 'nombre'])
    })
    console.log('  + servicio_registros')
  }

  if (!await db.schema.hasTable('lista_gastos')) {
    await db.schema.createTable('lista_gastos', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').nullable()
      t.string('nombre', 150).notNullable()
      t.integer('legacy_id').nullable().index()
      t.timestamps(true, true)
    })
    console.log('  + lista_gastos')
  } else if (!await db.schema.hasColumn('lista_gastos', 'legacy_id')) {
    await db.schema.alterTable('lista_gastos', t => {
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').nullable()
      t.integer('legacy_id').nullable().index()
    })
    console.log('  ~ lista_gastos (legacy_id)')
  }

  if (!await db.schema.hasTable('gastos')) {
    await db.schema.createTable('gastos', t => {
      t.increments('id')
      t.integer('lista_gasto_id').unsigned().references('id').inTable('lista_gastos').nullable()
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').nullable().index()
      t.string('descripcion', 255).nullable()
      t.decimal('valor', 15, 2).notNullable()
      t.date('fecha').nullable()
      t.timestamps(true, true)
    })
    console.log('  + gastos')
  }

  // ══════════════════════════════════════════════════════════════════
  // DOCUMENTOS (reemplaza multimedia/multimedias - archivos en storage privado)
  // ══════════════════════════════════════════════════════════════════

  if (!await db.schema.hasTable('documentos')) {
    await db.schema.createTable('documentos', t => {
      t.increments('id')
      // Owner polimorfico por FKs: exactamente una debe estar llena
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').nullable().index()
      t.integer('empleado_id').unsigned().references('id').inTable('empleados').onDelete('CASCADE').nullable().index()
      t.integer('persona_id').unsigned().references('id').inTable('personas').onDelete('CASCADE').nullable().index()
      t.integer('beneficiado_id').unsigned().references('id').inTable('beneficiados').onDelete('CASCADE').nullable()
      t.integer('planilla_id').unsigned().references('id').inTable('planillas').onDelete('CASCADE').nullable()
      t.integer('nomina_id').unsigned().references('id').inTable('nominas').onDelete('CASCADE').nullable()
      t.integer('servicio_id').unsigned().references('id').inTable('servicios').nullable()
      t.integer('uploaded_by').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      t.string('nombre', 255).notNullable()
      t.string('descripcion', 255).nullable()
      t.string('path', 500).notNullable()      // ruta relativa en storage privado
      t.string('mime', 100).nullable()
      t.integer('size').unsigned().nullable()
      t.timestamps(true, true)
    })
    console.log('  + documentos')
  }

  // ══════════════════════════════════════════════════════════════════
  // OPERACION: solicitudes, soporte, notificaciones, observaciones
  // ══════════════════════════════════════════════════════════════════

  if (!await db.schema.hasTable('solicitudes')) {
    await db.schema.createTable('solicitudes', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').nullable().index()
      t.integer('persona_id').unsigned().references('id').inTable('personas').nullable().index()
      t.integer('servicio_id').unsigned().references('id').inTable('servicios').nullable()
      t.string('descripcion', 500).nullable()
      t.enum('status', ['pendiente', 'en_proceso', 'completada', 'rechazada']).defaultTo('pendiente')
      t.timestamps(true, true)
    })
    console.log('  + solicitudes')
  }

  if (!await db.schema.hasTable('soportes')) {
    await db.schema.createTable('soportes', t => {
      t.increments('id')
      t.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable().index()
      t.string('asunto', 200).notNullable()
      t.text('mensaje').nullable()
      t.enum('status', ['abierto', 'en_proceso', 'cerrado']).defaultTo('abierto')
      t.timestamps(true, true)
    })
    console.log('  + soportes')
  }

  if (!await db.schema.hasTable('notificaciones')) {
    await db.schema.createTable('notificaciones', t => {
      t.increments('id')
      t.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE').nullable().index()
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').nullable().index()
      t.string('titulo', 200).nullable()
      t.text('mensaje').nullable()
      t.boolean('leida').defaultTo(false)
      t.timestamps(true, true)
    })
    console.log('  + notificaciones')
  }

  if (!await db.schema.hasTable('observaciones')) {
    await db.schema.createTable('observaciones', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').nullable().index()
      t.integer('empleado_id').unsigned().references('id').inTable('empleados').onDelete('CASCADE').nullable()
      t.integer('persona_id').unsigned().references('id').inTable('personas').onDelete('CASCADE').nullable()
      t.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      t.text('texto').notNullable()
      t.timestamps(true, true)
    })
    console.log('  + observaciones')
  }

  if (!await db.schema.hasTable('terceros')) {
    await db.schema.createTable('terceros', t => {
      t.increments('id')
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').nullable().index()
      t.string('nombre', 200).notNullable()
      t.string('num_documento', 50).nullable()
      t.string('tipo', 50).nullable()
      t.string('email', 150).nullable()
      t.string('telefono', 30).nullable()
      t.integer('legacy_id').nullable().index()
      t.timestamps(true, true)
    })
    console.log('  + terceros')
  } else if (!await db.schema.hasColumn('terceros', 'legacy_id')) {
    await db.schema.alterTable('terceros', t => {
      t.string('email', 150).nullable()
      t.string('telefono', 30).nullable()
      t.integer('legacy_id').nullable().index()
    })
    console.log('  ~ terceros (legacy_id)')
  }

  // ── Alteraciones sobre tablas ya creadas (idempotentes) ──────────────────

  // cuentas_cobro: status numerico como el viejo (1=Pagado 2=Pendiente 3=En tramite
  // 4=Activo 5=Rechazado) + columnas del registro viejo
  if (await db.schema.hasTable('cuentas_cobro')) {
    if (!await db.schema.hasColumn('cuentas_cobro', 'nombre')) {
      await db.schema.alterTable('cuentas_cobro', t => {
        t.string('nombre', 255).nullable()
        t.decimal('iva', 15, 2).defaultTo(0)
        t.decimal('cuatroxmil', 15, 2).defaultTo(0)
        t.text('obs').nullable()
        t.integer('legacy_id').nullable().index()
      })
      await db.raw('ALTER TABLE cuentas_cobro MODIFY status TINYINT NOT NULL DEFAULT 2')
      console.log('  ~ cuentas_cobro (columnas + status tinyint)')
    }
  }

  // soportes: status numerico + campos del ticket viejo
  if (await db.schema.hasTable('soportes')) {
    if (!await db.schema.hasColumn('soportes', 'tipo_solicitud')) {
      await db.schema.alterTable('soportes', t => {
        t.string('tipo_solicitud', 50).nullable()  // empresa / independiente
        t.string('tipo_servicio', 200).nullable()  // ASESORIA, AFILIACION A SEGURIDAD SOCIAL...
        t.string('nombre', 200).nullable()
        t.string('email', 191).nullable()
        t.string('telefono', 50).nullable()
        t.integer('legacy_id').nullable().index()
      })
      await db.raw('ALTER TABLE soportes MODIFY status TINYINT NOT NULL DEFAULT 1')
      console.log('  ~ soportes (columnas + status tinyint)')
    }
  }

  // sucursales: trazabilidad del ETL + sedes propias (empresa_id nullable:
  // id_empresa=0 en la vieja eran las oficinas de Soy Asesorias, no de clientes)
  if (await db.schema.hasTable('sucursales')) {
    if (!await db.schema.hasColumn('sucursales', 'legacy_id')) {
      await db.schema.alterTable('sucursales', t => {
        t.integer('legacy_id').nullable().index()
      })
      console.log('  ~ sucursales (legacy_id)')
    }
    // MODIFY es idempotente: permite NULL para sedes internas
    await db.raw('ALTER TABLE sucursales MODIFY empresa_id INT UNSIGNED NULL')
  }

  // servicio_registros: sucursal del detalle_servicios viejo
  if (await db.schema.hasTable('servicio_registros')) {
    if (!await db.schema.hasColumn('servicio_registros', 'sucursal_id')) {
      await db.schema.alterTable('servicio_registros', t => {
        t.integer('sucursal_id').unsigned().references('id').inTable('sucursales').onDelete('SET NULL').nullable()
      })
      console.log('  ~ servicio_registros (sucursal_id)')
    }
  }

  // cuentas_cobro / gastos: sucursal del registro viejo (informes por sucursal)
  if (await db.schema.hasTable('cuentas_cobro')) {
    if (!await db.schema.hasColumn('cuentas_cobro', 'sucursal_id')) {
      await db.schema.alterTable('cuentas_cobro', t => {
        t.integer('sucursal_id').unsigned().references('id').inTable('sucursales').onDelete('SET NULL').nullable()
      })
      console.log('  ~ cuentas_cobro (sucursal_id)')
    }
    if (!await db.schema.hasColumn('cuentas_cobro', 'tipo')) {
      await db.schema.alterTable('cuentas_cobro', t => {
        t.integer('tipo').nullable()               // 1=normal, otro=recurrente
        t.string('banco', 100).nullable()
        t.string('meses', 50).nullable()          // meses que cubre el recibo
        t.integer('tercero_id').unsigned().references('id').inTable('terceros').onDelete('SET NULL').nullable()
      })
      console.log('  ~ cuentas_cobro (tipo/banco/meses/tercero_id)')
    }
  }
  if (await db.schema.hasTable('gastos')) {
    if (!await db.schema.hasColumn('gastos', 'sucursal_id')) {
      await db.schema.alterTable('gastos', t => {
        t.integer('sucursal_id').unsigned().references('id').inTable('sucursales').onDelete('SET NULL').nullable()
      })
      console.log('  ~ gastos (sucursal_id)')
    }
    if (!await db.schema.hasColumn('gastos', 'nombre')) {
      await db.schema.alterTable('gastos', t => {
        t.string('nombre', 255).nullable()         // concepto
        t.decimal('iva', 15, 2).defaultTo(0)
        t.string('banco', 100).nullable()
        t.string('meses', 50).nullable()
        t.integer('tercero_id').unsigned().references('id').inTable('terceros').onDelete('SET NULL').nullable()
        t.integer('status').notNullable().defaultTo(2)  // mismos codigos que cuenta_cobro
        t.integer('legacy_id').nullable().index()
      })
      console.log('  ~ gastos (nombre/iva/banco/meses/tercero/status/legacy_id)')
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // COMERCIAL / VENTAS (replica marketing_* del sistema anterior)
  // ══════════════════════════════════════════════════════════════════

  if (!await db.schema.hasTable('embudos')) {
    await db.schema.createTable('embudos', t => {
      t.increments('id')
      t.string('slug', 60).notNullable().unique()
      t.string('nombre', 120).notNullable()
      t.string('descripcion', 255).nullable()
      t.enum('tipo', ['cliente', 'suscriptor']).defaultTo('cliente')
      t.boolean('activo').defaultTo(true)
      t.timestamps(true, true)
    })
    console.log('  + embudos')
  }

  if (!await db.schema.hasTable('embudo_etapas')) {
    await db.schema.createTable('embudo_etapas', t => {
      t.increments('id')
      t.integer('embudo_id').unsigned().references('id').inTable('embudos').onDelete('CASCADE').notNullable().index()
      t.string('slug', 60).notNullable()
      t.string('nombre', 120).notNullable()
      t.string('descripcion', 255).nullable()
      t.integer('posicion').defaultTo(1)
      t.boolean('es_cierre').defaultTo(false)
      t.boolean('es_perdido').defaultTo(false)
      t.timestamps(true, true)
    })
    console.log('  + embudo_etapas')
  }

  if (!await db.schema.hasTable('leads')) {
    await db.schema.createTable('leads', t => {
      t.increments('id')
      t.integer('embudo_id').unsigned().references('id').inTable('embudos').onDelete('CASCADE').notNullable().index()
      t.integer('etapa_id').unsigned().references('id').inTable('embudo_etapas').index()
      t.string('nombre', 150).notNullable()
      t.string('nombre_emprendedor', 150).nullable()
      t.string('empresa', 160).nullable()
      t.string('email', 160).nullable()
      t.string('telefono', 60).nullable()
      t.string('fuente', 120).nullable()
      t.string('campania', 120).nullable()
      t.integer('usuario_asignado_id').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      t.integer('orden_pos').defaultTo(0)
      t.dateTime('ultimo_contacto_en').nullable()
      t.dateTime('etapa_cambiada_en').nullable()
      t.text('notas').nullable()
      t.text('metadata').nullable()
      // vinculos a entidades reales al convertirse el lead
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('SET NULL').nullable()
      t.integer('persona_id').unsigned().references('id').inTable('personas').onDelete('SET NULL').nullable()
      t.timestamps(true, true)
    })
    console.log('  + leads')
  }

  if (!await db.schema.hasTable('lead_historial')) {
    await db.schema.createTable('lead_historial', t => {
      t.increments('id')
      t.integer('lead_id').unsigned().references('id').inTable('leads').onDelete('CASCADE').notNullable().index()
      t.integer('embudo_id').unsigned().nullable()
      t.integer('etapa_id').unsigned().nullable()
      t.integer('usuario_id').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      t.text('nota').nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
    })
    console.log('  + lead_historial')
  }

  // ── Seed de embudos y etapas (mismas del sistema anterior) ──────────────
  if (await db.schema.hasTable('embudos')) {
    const n = await db('embudos').count('id as n').first()
    if (Number(n.n) === 0) {
      const [embudoClientes] = await db('embudos').insert({
        slug: 'clientes', nombre: 'Embudo de clientes',
        descripcion: 'Seguimiento de leads provenientes de formularios comerciales.', tipo: 'cliente',
      })
      const [embudoSuscriptores] = await db('embudos').insert({
        slug: 'suscriptores', nombre: 'Embudo de suscriptores',
        descripcion: 'Gestión de suscripciones y nurturing desde el formulario público.', tipo: 'suscriptor',
      })

      const etapasBase = [
        ['lead-nuevo', 'Lead nuevo', 'Contacto registrado que aún no ha sido abordado.', 1, 0, 0],
        ['primera-asesoria', 'Lead primera asesoría', 'Lead agendado para una primera asesoría o discovery.', 2, 0, 0],
        ['realizar-propuesta', 'Realizar propuesta', 'Se debe preparar y enviar una propuesta al lead.', 3, 0, 0],
        ['socializar-propuesta', 'Socializar la propuesta', 'Propuesta enviada, en proceso de socialización con el lead.', 4, 0, 0],
        ['seguimiento', 'Seguimiento', 'Seguimiento activo para resolver dudas y avanzar al cierre.', 5, 0, 0],
        ['lead-ganado', 'Lead ganado', 'Lead convertido a cliente.', 6, 1, 0],
        ['lead-perdido', 'Lead perdido', 'Lead descartado o sin avance.', 7, 1, 1],
      ]
      for (const embudoId of [embudoClientes, embudoSuscriptores]) {
        await db('embudo_etapas').insert(
          etapasBase.map(([slug, nombre, descripcion, posicion, cierre, perdido]) => ({
            embudo_id: embudoId, slug, nombre, descripcion,
            posicion, es_cierre: !!cierre, es_perdido: !!perdido,
          }))
        )
      }
      console.log('  ~ embudos/etapas seed')
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // DIAGNÓSTICOS (replica producto_* del sistema anterior)
  // ══════════════════════════════════════════════════════════════════

  if (!await db.schema.hasTable('diagnosticos')) {
    await db.schema.createTable('diagnosticos', t => {
      t.increments('id')
      t.string('nombre', 200).notNullable()
      t.integer('empresa_id').unsigned().references('id').inTable('empresas').onDelete('CASCADE').nullable().index()
      t.integer('persona_id').unsigned().references('id').inTable('personas').onDelete('CASCADE').nullable().index()
      t.integer('responsable_id').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      t.date('fecha_inicio').notNullable()
      t.date('fecha_fin').notNullable()
      t.enum('estado', ['pendiente', 'en_progreso', 'logrado', 'cancelado']).defaultTo('pendiente')
      t.timestamps(true, true)
    })
    console.log('  + diagnosticos')
  }

  if (!await db.schema.hasTable('diagnostico_preguntas')) {
    await db.schema.createTable('diagnostico_preguntas', t => {
      t.increments('id')
      t.string('slug', 100).notNullable()
      t.string('titulo', 255).notNullable()
      t.text('descripcion').nullable()
      t.enum('tipo_respuesta', ['texto', 'textarea', 'numero', 'fecha', 'opciones', 'multiple', 'booleano']).notNullable()
      t.text('opciones').nullable()            // JSON array
      t.boolean('es_obligatoria').defaultTo(false)
      t.text('ayuda_contextual').nullable()
      t.integer('orden').defaultTo(1)
      t.boolean('activo').defaultTo(true)
      t.timestamps(true, true)
    })
    console.log('  + diagnostico_preguntas')
  }

  if (!await db.schema.hasTable('diagnostico_respuestas')) {
    await db.schema.createTable('diagnostico_respuestas', t => {
      t.increments('id')
      t.integer('diagnostico_id').unsigned().references('id').inTable('diagnosticos').onDelete('CASCADE').notNullable().index()
      t.integer('pregunta_id').unsigned().references('id').inTable('diagnostico_preguntas').onDelete('CASCADE').notNullable()
      t.text('valor').nullable()
      t.text('valor_json').nullable()
      t.unique(['diagnostico_id', 'pregunta_id'])
      t.timestamps(true, true)
    })
    console.log('  + diagnostico_respuestas')
  }

  if (!await db.schema.hasTable('diagnostico_doc_config')) {
    await db.schema.createTable('diagnostico_doc_config', t => {
      t.increments('id')
      t.string('slug', 100).notNullable()
      t.string('titulo', 255).notNullable()
      t.text('descripcion').nullable()
      t.boolean('es_obligatorio').defaultTo(false)
      t.string('tipo_archivo', 100).nullable() // pdf,jpg,png
      t.integer('maximo_archivos').nullable()
      t.integer('orden').defaultTo(1)
      t.boolean('activo').defaultTo(true)
      t.timestamps(true, true)
    })
    console.log('  + diagnostico_doc_config')
  }

  if (!await db.schema.hasTable('diagnostico_documentos')) {
    await db.schema.createTable('diagnostico_documentos', t => {
      t.increments('id')
      t.integer('diagnostico_id').unsigned().references('id').inTable('diagnosticos').onDelete('CASCADE').notNullable().index()
      t.integer('doc_config_id').unsigned().references('id').inTable('diagnostico_doc_config').onDelete('CASCADE').notNullable()
      t.enum('estado', ['pendiente', 'revisar', 'aprobado', 'rechazado', 'renovar']).defaultTo('pendiente')
      t.text('comentarios_revision').nullable()
      t.string('ruta_archivo', 255).nullable()
      t.string('nombre_original', 255).nullable()
      t.string('mime_type', 100).nullable()
      t.bigInteger('tamano_bytes').nullable()
      t.dateTime('fecha_revision').nullable()
      t.integer('revisado_por').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      t.unique(['diagnostico_id', 'doc_config_id'])
      t.timestamps(true, true)
    })
    console.log('  + diagnostico_documentos')
  }

  if (!await db.schema.hasTable('diagnostico_informes')) {
    await db.schema.createTable('diagnostico_informes', t => {
      t.increments('id')
      t.integer('diagnostico_id').unsigned().references('id').inTable('diagnosticos').onDelete('CASCADE').notNullable().unique()
      t.text('contenido_html').nullable()
      t.timestamps(true, true)
    })
    console.log('  + diagnostico_informes')
  }

  // ── Seed preguntas de entrevista (mismas del sistema anterior) ──────────
  if (await db.schema.hasTable('diagnostico_preguntas')) {
    const n = await db('diagnostico_preguntas').count('id as n').first()
    if (Number(n.n) === 0) {
      const preguntas = [
        ['cual-es-el-mayor-reto-gestion-talento', '¿Cuál es el mayor reto que enfrentan en la gestión de su talento humano hoy en día?', 'Permite identificar el principal punto de dolor o desafío actual en los procesos de recursos humanos.', 'textarea', null, 1, 'Sé específico: menciona rotación, ausentismo, clima laboral, nómina o problemas de comunicación interna.', 1],
        ['que-les-gustaria-solucionar-auditoria', '¿Qué les gustaría solucionar con esta auditoría?', 'Ayuda a comprender las expectativas y resultados esperados por el cliente.', 'texto', null, 1, 'Describe en una o dos frases qué esperas mejorar o resolver con el proceso.', 2],
        ['herramientas-software-nomina-rrhh', '¿Qué herramientas o software utilizan actualmente para la gestión de nómina o RR.HH.?', 'Permite conocer la madurez digital y las herramientas activas en la gestión de talento.', 'texto', null, 1, 'Indica si usan Excel, ERP, software SaaS u otro sistema. Si no usan ninguno, indícalo.', 3],
        ['problemas-rotacion-personal', '¿Se han enfrentado a problemas con la rotación de personal?', 'Identifica dificultades en la retención y estabilidad del equipo.', 'texto', null, 1, 'Indica si la rotación es alta, moderada o baja y, si es posible, las causas principales.', 4],
        ['tienen-encargado-rh', '¿Tienen encargado de RRHH?', 'Determina si existe un responsable directo para la gestión de talento en la empresa.', 'booleano', null, 1, 'Responde Sí/No. Si es Sí, escribe el nombre, cargo y datos de contacto en el campo de detalle adicional.', 5],
        ['camara-comercio-rut', '¿Cuenta con el certificado de Cámara de Comercio y RUT actualizados?', 'Verifica la formalidad legal de la empresa.', 'texto', null, 1, 'Si dispone de los documentos, súbelos en formato PDF o imagen clara. Si no están actualizados, indícalo.', 6],
        ['numero-trabajadores-tipo-contratos', '¿Cuántos trabajadores tienen actualmente y qué tipo de contratos utilizan?', 'Permite dimensionar la estructura laboral y la diversidad contractual.', 'texto', null, 1, 'Especifica el número total y los tipos de contrato (fijo, indefinido, prestación de servicios, etc.).', 7],
        ['proyeccion-plantilla-nomina', '¿Cuenta con una proyección de nómina y una plantilla de nómina en Excel?', 'Valida control financiero y trazabilidad del gasto en personal.', 'texto', null, 1, 'Súbelos si los tienes. Si no, indica si están en proceso de elaboración.', 8],
        ['contratos-laborales-firmados', '¿Dispone de contratos laborales firmados y actualizados?', 'Evalúa el cumplimiento de requisitos legales básicos en la contratación.', 'booleano', null, 1, 'Indica si todos los contratos están firmados y vigentes; si es posible, carga una muestra representativa.', 9],
        ['manual-de-funciones', '¿Cuenta con un manual de funciones vigente?', 'Verifica la existencia de una herramienta organizacional que define roles y responsabilidades.', 'booleano', null, 1, 'Si lo tiene, súbelo en PDF o Word; si no, indica si está en proceso de actualización.', 10],
        ['reglamento-politicas-internas', '¿Tiene reglamento interno de trabajo y políticas internas?', 'Evalúa cumplimiento normativo interno y prácticas de gestión.', 'booleano', null, 1, 'Adjunta el documento o indica si no aplica según el tamaño de la empresa.', 11],
        ['contratos-prestacion-servicios', '¿Gestiona actualmente contratos por prestación de servicios?', 'Identifica la existencia de colaboradores externos y su nivel de formalidad.', 'texto', null, 1, 'Indica cuántos contratistas tienen y si se lleva registro de pagos o informes de actividades.', 12],
      ]
      await db('diagnostico_preguntas').insert(
        preguntas.map(([slug, titulo, descripcion, tipo, opciones, obligatoria, ayuda, orden]) => ({
          slug, titulo, descripcion, tipo_respuesta: tipo, opciones,
          es_obligatoria: !!obligatoria, ayuda_contextual: ayuda, orden,
        }))
      )
      console.log('  ~ diagnostico_preguntas seed')
    }
  }

  // ── Seed documentos requeridos (mismos del sistema anterior) ────────────
  if (await db.schema.hasTable('diagnostico_doc_config')) {
    const n = await db('diagnostico_doc_config').count('id as n').first()
    if (Number(n.n) === 0) {
      const docs = [
        ['registro-camara-de-comercio', 'Registro Cámara de Comercio', 'Certificado de existencia y representación legal expedido por Cámara de Comercio.', 1, 'pdf,jpg,png', 1, 1],
        ['rut', 'RUT / NIT / Identificación fiscal', 'Documento que identifica fiscalmente a la empresa (RUT, NIT o equivalente).', 1, 'pdf,jpg,png', 1, 2],
        ['plantilla-nomina-excel', 'Plantilla de nómina (Excel)', 'Archivo Excel con la plantilla de nómina: columnas mínimas nombre, documento, cargo, salario, deducciones y neto.', 1, 'xlsx,xls,csv', 1, 3],
        ['proyeccion-nomina', 'Proyección de nómina', 'Documento o spreadsheet con la proyección presupuestal de nómina (mensual/anual).', 1, 'xlsx,pdf', 1, 4],
        ['contratos-laborales', 'Contratos laborales (muestra)', 'Contratos firmados de ejemplo que se usan en la empresa (empleados y/o contratistas).', 1, 'pdf,doc,docx', 3, 5],
        ['manual-funciones', 'Manual de funciones', 'Documento que define roles, responsabilidades y perfiles de cargo.', 1, 'pdf,doc,docx', 1, 6],
        ['reglamento-interno-politicas', 'Reglamento interno y políticas', 'Reglamento interno de trabajo y políticas internas (disciplinarias, compensaciones, permisos, etc.).', 1, 'pdf,doc,docx', 1, 7],
        ['contratos-prestacion-servicios', 'Contratos por prestación de servicios', 'Contratos y registros de prestadores de servicios externos (freelancers, consultores).', 1, 'pdf,doc,docx', 5, 8],
        ['registro-conflictos-trabajadores', 'Registro de conflictos con trabajadores', 'Documentación de quejas, sanciones, conciliaciones o demandas; si no existen, indicar "No aplica".', 0, 'pdf,doc,docx', 5, 9],
      ]
      await db('diagnostico_doc_config').insert(
        docs.map(([slug, titulo, descripcion, obligatorio, tipos, maximo, orden]) => ({
          slug, titulo, descripcion, es_obligatorio: !!obligatorio,
          tipo_archivo: tipos, maximo_archivos: maximo, orden,
        }))
      )
      console.log('  ~ diagnostico_doc_config seed')
    }
  }

  // Permiso de módulo "diagnosticos" en user_modulos
  if (await db.schema.hasTable('user_modulos')) {
    if (!await db.schema.hasColumn('user_modulos', 'diagnosticos')) {
      await db.schema.alterTable('user_modulos', t => {
        t.boolean('diagnosticos').defaultTo(false)
      })
      console.log('  ~ user_modulos (diagnosticos)')
    }
  }

  // Refresh tokens (rotación: cada uso revoca el anterior)
  if (!await db.schema.hasTable('refresh_tokens')) {
    await db.schema.createTable('refresh_tokens', t => {
      t.increments('id')
      t.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').index()
      t.string('token_hash', 64).notNullable().index()
      t.datetime('expires_at').notNullable()
      t.datetime('revoked_at').nullable()
      t.string('ip', 45).nullable()
      t.string('user_agent', 255).nullable()
      t.timestamps(true, true)
    })
    console.log('  + refresh_tokens')
  }

  console.log('Migraciones completadas.')
}
