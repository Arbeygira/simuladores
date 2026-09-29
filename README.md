# Forma Simuladores

Aplicación educativa con un monitor de signos vitales y un montaje EEG compartidos en tiempo real entre un docente y sus estudiantes.

## Ejecución local

Requiere Node.js 20 o posterior.

```sh
npm install
npm start
```

Abre `http://localhost:4173`. El docente crea una sala y comparte el código; cada estudiante lo introduce desde la misma dirección. No abras los HTML directamente con `file://`: la conexión de sala necesita HTTP y WebSocket.

## Publicación en Internet

Despliega esta carpeta como un servicio Node.js que admita WebSocket y configure su puerto mediante `PORT`. El proxy del hosting debe permitir el upgrade de `/sync`; en producción la página negocia `WSS` automáticamente con HTTPS.

Las salas y su estado viven en memoria: se eliminan al reiniciar el servidor y esta configuración requiere una sola instancia del servicio. No habilites varias réplicas sin añadir almacenamiento y sincronización compartidos.

El código de sala permite entrar como estudiante; la clave de expositor se conserva sólo en la sesión del docente. El servidor rechaza mensajes de modificación de sesiones estudiante. Usa HTTPS al publicar el servicio.
