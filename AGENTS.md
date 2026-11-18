# FITWare — guía de continuidad

Antes de modificar el proyecto, leer `docs/CONTINUITY.md` y las secciones pertinentes del README. El pedido actual del usuario tiene prioridad sobre estas notas; las observaciones históricas deben verificarse antes de actuar.

- Aplicación de gestión de gimnasios: React + TypeScript en `apps/web`; Node + Express + TypeScript en `apps/api`; PostgreSQL. Mantener esta tecnología y el diseño existente.
- Interfaz y mensajes en español rioplatense. Priorizar facilidad de uso para recepción y dueños. Comentarios de código breves y útiles en las partes complejas.
- Instalación: `npm ci --include=dev`. Desarrollo: `npm run dev`. Compilación: `npm run build`. Pruebas: `npm test`. Formato: `npm run format`. Leer `.env.example`; usar únicamente datos ficticios en pruebas.
- No publicar credenciales, archivos `.env`, enlaces de recuperación, sesiones, fotos o datos de clientes, ni información financiera personal en documentación. El repositorio es público.
- Preservar aislamiento entre organizaciones/sedes, permisos, idempotencia, transacciones, historial de anulaciones y cálculo exacto en centavos. Los pendientes de acreditación no habilitan pases ni cuentan como ingresos.
- No asumir que Mercado Pago o SMTP están conectados. No realizar transacciones reales para probar. No contratar recursos pagos sin aprobación de costo.
- Antes de publicar verificar la rama remota, cambios locales y autorización vigente. No forzar referencias ni sobrescribir trabajo ajeno. No duplicar despliegues si Render ya los dispara automáticamente.
- Informar qué se cambió, qué se comprobó y qué quedó pendiente; distinguir pruebas automatizadas de revisión visual o hardware real.
- Si Notion está conectado, consultar el contexto privado de FITWare y las instrucciones personales vigentes del usuario. No copiar documentación privada completa al repositorio público. Si no está conectado, continuar con el contexto del repositorio e informar la limitación.

## Validación de formularios

Usar `Form` y `Field` para mostrar los errores y conservar las etiquetas accesibles. Consultar `docs/CONTINUITY.md` para conocer el estado de verificación y publicación.
