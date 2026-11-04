# Configuración del Asistente IA con Gemini

La clave se configura únicamente en el servidor de la API, nunca en Angular,
`public/config.json`, Git ni en una conversación.

En cPanel, abre **Setup Node.js App** para `soyasesorias-api-app` y agrega estas
variables de entorno:

```env
AI_PROVIDER=gemini
AI_GEMINI_API_KEY=TU_CLAVE_DE_GEMINI
AI_MODEL=gemini-3.6-flash
```

La URL del endpoint compatible de Gemini se configura automáticamente como
`https://generativelanguage.googleapis.com/v1beta/openai`; la API añade
`/chat/completions`. Si tu cuenta usa otro modelo, cambia `AI_MODEL` por el
identificador exacto habilitado en Gemini.

Después de guardar las variables, reinicia solo los procesos `lsnode` de esta
API, siguiendo el procedimiento de `AGENTS.md`. Si la clave no está configurada,
el chat responde que el servicio aún no está disponible.

Las conversaciones se guardan en `ia_chat_sesiones` y `ia_chat_mensajes`,
siempre ligadas al usuario autenticado; cada usuario solo puede consultar o
eliminar sus propias sesiones. La API crea estas tablas al iniciar. Si necesitas
aplicar el esquema manualmente, ejecuta `actualizar_asistente_ia.sql`.

Gemini no recibe credenciales de base de datos ni puede ejecutar acciones en la
aplicación. Cuando un usuario autorizado pide un informe de solicitudes, la API
consulta el reporte de solo lectura con el alcance del usuario y le envía a
Gemini únicamente conteos agregados por fecha, estado y tipo (sin nombres,
documentos ni contenido de archivos). Para otros informes, el usuario debe
compartir los resultados visibles en pantalla.
