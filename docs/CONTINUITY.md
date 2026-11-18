# FITWare — contexto para continuar en Codex

Actualizado: 17 de noviembre de 2026 (Argentina). Este documento resume el proyecto y el pedido pendiente; no es una copia literal del chat ni de las memorias privadas.

## Objetivo y tecnología

El dueño del proyecto quiere una aplicación simple y completa para gestionar gimnasios y aprender mientras la desarrolla. Solicitó Node.js, Express, React y TypeScript a partir de sus cursos de Fernando Herrera. No adaptar la implementación al avance de los cursos.

Repositorio: https://github.com/GuiCon5k/Fitware

Aplicación: https://fitware-3olk.onrender.com/

Monorepo npm: API en `apps/api`, frontend en `apps/web`. PostgreSQL externo en producción y PGlite para desarrollo/pruebas. El servidor Express sirve también el frontend compilado. Consultar README, package.json y `.env.example` para instrucciones completas.

## Estado conocido y comprobaciones

Último commit funcional verificado en esta conversación: `270a1eb5f78dd9cef823d594aa24228b999029a5`, versión 4.0.1. Se verificó el 10/11 por la noche en Argentina (11/11 UTC) mediante `/api/health`, que respondió con la versión y el commit exactos. La compilación y 69 pruebas pasaron entonces (52 API y 17 UI). Son resultados históricos: volver a comprobar el estado remoto y los archivos antes de continuar.

La API de gestión de Render falló durante parte de esa publicación. No confundir aceptación de un despliegue con versión activa; verificar el endpoint público y, cuando sea posible, estado y logs del despliegue. El navegador no permitió completar la revisión visual. No se realizaron pruebas físicas de cámara, lector ni molinete.

## Necesidades del gimnasio y funciones existentes

Volumen informado: aproximadamente 500 pases mensuales entre altas y renovaciones; no es telemetría ni prueba de capacidad productiva.

- Registro de dueño, login, recuperación, contraseña repetida y mostrar/ocultar contraseña. Sesiones HttpOnly, validación en servidor y normalización de entradas; contraseñas y tokens no se recortan.
- Organizaciones y varias sedes, perfil personal, empleados recepcionistas/entrenadores con permisos configurables por dueño.
- Socios con DNI editable, teléfono, dirección, contacto de emergencia y varias actividades. Alta con primer cobro atómico opcional; importación Excel/CSV con vista previa y sin sobrescribir socios.
- Pases por mes calendario: pago el 1 de enero renueva el 1 de febrero; duración en días configurable. Se preserva el ancla para fines de mes.
- Promociones 2x1 (dos socios, un pase), combos de actividades y descuentos. Se distribuyen importes y descuentos sin duplicar ingresos; una orden puede tener varias filas de pases.
- Cuotas con fecha, nombre, DNI, teléfono, pase, precio final, medio, referencia y promoción. Búsqueda/paginación en servidor y descarga Excel. El contacto muestra la ficha actual; importes, planes y medios conservan su snapshot.
- Medios de pago específicos configurables para cuotas, consumibles y egresos; clasificación contable efectivo/electrónico.
- Bandeja de acreditaciones pendientes con revisión manual o verificación puntual por Mercado Pago. Un pendiente no activa pases ni genera ingreso. Confirmación atómica e idempotente, con importe/vencimientos revisados y trazabilidad.
- Consumibles con stock, mínimos, reposiciones, ajustes, costo promedio ponderado y ventas atómicas.
- Caja diaria y arqueos con saldo inicial, esperado/contado por medio, diferencias y revisiones conservadas. Detectar cambios posteriores. Resumen/balances por período y sede, actividades, ingresos, gastos y uso registrado por área. Son pantallas con propósitos distintos.
- Recepción por DNI/nombre o QR revocable, foto privada en PostgreSQL y registro de intentos permitidos/rechazados. Cámara solo en navegadores compatibles; alternativa lector USB o búsqueda manual. No abre un molinete.
- Anulación con motivo, historial conservado, corrección de stock y exclusión de totales. Respaldos por organización y restauración en base nueva.

## Límites y decisiones importantes

Las cuotas del gimnasio y el pago de la suscripción de FITWare son circuitos independientes. La suscripción se definió en USD 15 por mes calendario, convertida a ARS; no cambiar precio o receptor sin pedido. No incluir aquí datos de la cuenta receptora.

Mercado Pago y SMTP reales siguen pendientes de configuración/pruebas. La conexión inicial de cuotas admite una sede por despliegue; no es una integración OAuth multi-comercio. Verificación MP puntual por operación, sin sincronización continua de devoluciones/contracargos ni garantía de acceso a transferencias personales a CVU. El operador comprueba el socio al que corresponde el pago. Las credenciales deben configurarse privadamente en el servidor.

Base de prueba de Render: su vencimiento informado fue el 5 de diciembre de 2026; verificar vigencia actual. No convertir a pago sin aprobación. Los archivos de respaldos del servidor gratuito son temporales: descargar fuera del servicio; las fotos operativas están en PostgreSQL. No asumir que sesiones o conexiones de esta conversación se transfieren a otro entorno de Codex.

En la revisión de dependencias se actualizaron Express/body-parser para corregir una alerta alta. Quedaron documentadas alertas moderadas transitivas de uuid/ExcelJS; la versión revisada de ExcelJS usaba v4, mientras el aviso referido afectaba otras funciones. Volver a revisar versiones/avisos vigentes; no aplicar `npm audit fix --force` a ciegas.

## Pedido pendiente actual: validaciones y etiquetas flotantes

Pedido del usuario: mejorar los mensajes de validación en todos los formularios, evitar los globos de validación nativa del navegador y mostrar mensajes propios dentro de la interfaz. Los títulos como Nombre y Email deben verse dentro del campo vacío y subir suavemente al enfocarlo; deben permanecer arriba si el campo tiene contenido.

Estado: se inspeccionó el código y se explicó el enfoque. **No está implementado todavía.** El usuario pidió preparar esta transferencia antes de continuar; no presentar esta tarea como terminada.

Archivos relevantes:

- `apps/web/src/form-guidance.ts`: hoy escucha `invalid` en document, modifica `setCustomValidity` y `aria-invalid`; todavía utiliza la validación nativa. Se llama desde App.
- `apps/web/src/components.tsx`: `Field` es actualmente un label con un span arriba y children.
- `apps/web/src/password-input.tsx`: campo de contraseña con label separado, botón mostrar/ocultar e indicación opcional.
- `apps/web/src/api.ts`: lanza Error con el texto del backend; actualmente descarta el mapa `fields` de las respuestas de validación.
- `apps/web/src/app.tsx`: login/registro y montaje principal; Auth también se usa directamente en pruebas.
- `apps/web/src/editor.tsx`: formularios de socios, planes, pagos, productos, reposiciones, ventas, promociones, empleados, sede, egresos y perfil.
- `apps/web/src/workspace-tools.tsx`: recuperación, importación, configuración y anulación.
- `apps/web/src/gym-tools.tsx`: medios de pago, acreditaciones, fotos, recepción y arqueo.
- `apps/web/src/styles.css` y pruebas en `apps/web/test`.

Criterios de aceptación propuestos a partir del pedido:

1. Evitar validación emergente nativa al enviar, conservando las restricciones reales y la validación del backend.
2. Mostrar errores específicos en español junto al campo; resumen útil si hay varios y foco en el primer error. No enviar operaciones inválidas ni borrar lo ingresado.
3. Corregir o retirar el error al editar/revalidar; evitar errores de campos ocultos o formularios desmontados.
4. Etiquetas flotantes suaves con campos vacíos, enfocados, completos, precargados y autocompletados; respetar reducción de movimiento. Mantener labels accesibles, teclado y vínculos entre error/campo.
5. Cubrir texto, email, contraseña, textarea, números, fechas, select y cargas de archivo con el tratamiento adecuado; no superponer labels con controles nativos ni el botón de mostrar contraseña.
6. Verificar registro y recuperación, comparaciones de contraseñas, formularios operativos y errores devueltos por la API. Añadir pruebas de regresión relevantes y comprobar escritorio/móvil visualmente cuando el entorno lo permita.
7. Compilar, ejecutar pruebas, publicar solo con autorización vigente y confirmar la versión servida. Actualizar este estado al completar la tarea.

## Cómo iniciar la próxima sesión

Abrir/clonar este repositorio en el entorno de Codex elegido. Pedir: «Leé AGENTS.md y docs/CONTINUITY.md. Continuá el pedido pendiente de validaciones personalizadas y etiquetas flotantes suaves. Verificá el estado remoto antes de editar y conservá las reglas de cobros y permisos».

El contexto está disponible en el repositorio; no se creó automáticamente una sesión de trabajo en otra aplicación ni se transfirieron accesos de GitHub, Render o Notion. Esas conexiones dependen del entorno de destino.
