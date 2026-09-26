// Express 4 no atrapa promesas rechazadas: un throw en un handler async
// tumba el proceso con unhandledRejection. Este shim envuelve cada
// handler para que el error vaya al middleware de error central.
// Importar ANTES de registrar las rutas (app.js ya lo hace).
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Layer = require('express/lib/router/layer')

const ORIGINAL = Layer.prototype.handle_request
Layer.prototype.handle_request = function handleRequest(req, res, next) {
  const fn = this.handle
  // Solo se envuelven handlers normales (los de error tienen 4 args)
  if (fn && fn.length <= 3 && !fn.__asyncWrapped) {
    const wrapped = function (req2, res2, next2) {
      try {
        Promise.resolve(fn(req2, res2, next2)).catch(next2)
      } catch (err) {
        next2(err)
      }
    }
    wrapped.__asyncWrapped = true
    this.handle = wrapped
  }
  return ORIGINAL.call(this, req, res, next)
}
