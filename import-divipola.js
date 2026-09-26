import fs from 'node:fs'
import db from './src/db/knex.js'

const DEPTO_NOMBRES = {
  'AMAZONAS': 'Amazonas', 'ANTIOQUIA': 'Antioquia', 'ARAUCA': 'Arauca',
  'ARCHIPIÉLAGO DE SAN ANDRÉS, PROVIDENCIA Y SANTA CATALINA': 'San Andrés y Providencia',
  'ATLÁNTICO': 'Atlántico', 'BOGOTÁ, D.C.': 'Bogotá, D.C.', 'BOLÍVAR': 'Bolívar',
  'BOYACÁ': 'Boyacá', 'CALDAS': 'Caldas', 'CAQUETÁ': 'Caquetá', 'CASANARE': 'Casanare',
  'CAUCA': 'Cauca', 'CESAR': 'Cesar', 'CHOCÓ': 'Chocó', 'CÓRDOBA': 'Córdoba',
  'CUNDINAMARCA': 'Cundinamarca', 'GUAINÍA': 'Guainía', 'GUAVIARE': 'Guaviare',
  'HUILA': 'Huila', 'LA GUAJIRA': 'La Guajira', 'MAGDALENA': 'Magdalena',
  'META': 'Meta', 'NARIÑO': 'Nariño', 'NORTE DE SANTANDER': 'Norte de Santander',
  'PUTUMAYO': 'Putumayo', 'QUINDIO': 'Quindío', 'RISARALDA': 'Risaralda',
  'SANTANDER': 'Santander', 'SUCRE': 'Sucre', 'TOLIMA': 'Tolima',
  'VALLE DEL CAUCA': 'Valle del Cauca', 'VAUPÉS': 'Vaupés', 'VICHADA': 'Vichada',
}

const MINOR = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en'])
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const title = s => s.toLowerCase().split(/\s+/).map((w, i) =>
  i > 0 && MINOR.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
).join(' ')

const rows = JSON.parse(fs.readFileSync('divipola.json', 'utf-8'))

await db.transaction(async trx => {
  const deptos = await trx('departamentos').select('id', 'nombre', 'codigo_dane')
  const depIdByDane = {}
  const depIdByNorm = Object.fromEntries(deptos.map(d => [norm(d.nombre), d.id]))

  for (const r of rows) {
    const dane = r.cod_dpto
    if (depIdByDane[dane]) continue
    const nombre = DEPTO_NOMBRES[norm(r.dpto)] || title(r.dpto)
    let id = depIdByNorm[norm(nombre)]
    if (id) {
      await trx('departamentos').where('id', id).update({ codigo_dane: dane })
    } else {
      ;[id] = await trx('departamentos').insert({ nombre, codigo_dane: dane })
      depIdByNorm[norm(nombre)] = id
    }
    depIdByDane[dane] = id
  }

  // Corrige ciudad seed "Bogotá" que quedó bajo Cundinamarca → Bogotá, D.C. (cod_dpto 11)
  const bogota = depIdByDane['11']
  if (bogota) await trx('ciudades').where({ id: 5 }).update({ departamento_id: bogota })

  const existentes = await trx('ciudades').select('id', 'departamento_id', 'nombre')
  const ciuByKey = {}
  for (const c of existentes) ciuByKey[`${c.departamento_id}|${norm(c.nombre)}`] = c.id

  let nuevas = 0, actualizadas = 0
  const batch = []
  for (const r of rows) {
    const depId = depIdByDane[r.cod_dpto]
    const nombre = title(r.nom_mpio)
    const dane = r.cod_mpio.slice(-3)
    const key = `${depId}|${norm(nombre)}`
    if (ciuByKey[key]) {
      await trx('ciudades').where('id', ciuByKey[key]).update({ codigo_dane: dane })
      actualizadas++
    } else {
      batch.push({ departamento_id: depId, nombre, codigo_dane: dane })
      nuevas++
    }
  }
  for (let i = 0; i < batch.length; i += 200) await trx('ciudades').insert(batch.slice(i, i + 200))

  console.log(`departamentos: ${await trx('departamentos').count('* as c').first().then(r => r.c)} | ciudades nuevas: ${nuevas}, actualizadas: ${actualizadas}`)
})

await db.destroy()
