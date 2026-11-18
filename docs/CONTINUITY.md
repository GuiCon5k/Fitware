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

## Validaciones personalizadas y etiquetas flotantes

Implementadas sobre la base del commit `352db89`.

- `Form` en `apps/web/src/form-guidance.tsx` lee las restricciones de los controles al enviar sin abrir los globos del navegador. Muestra los errores junto a cada campo, resume cuando hay varios y enfoca el primero. Conserva los datos ingresados, retira los errores al editar y descarta los de campos que salieron del formulario.
- `api.ts` conserva el mapa `fields` de Express. Los formularios ubican esos mensajes junto al control correspondiente y muestran un aviso general para los errores sin campo.
- `Field` y `PasswordInput` comparten etiquetas accesibles. En campos de texto, numéricos y de varias líneas, la etiqueta sube al enfocar y queda arriba mientras haya contenido. Las fechas, selectores y archivos conservan la etiqueta encima para dejar espacio a los controles del navegador. Se respeta la reducción de movimiento.
- Se aplicó a ingreso, registro, recuperación, editores, configuración, anulación, medios de pago, acreditaciones, recepción y arqueo. Importación y fotos muestran el error junto al selector de archivo. Los importes, permisos y reglas de confirmación siguen bajo validación de la API.

La compilación pasó. Se ejecutaron 52 pruebas de API y 20 de interfaz. En Windows, la prueba del comando de restauración usó un adaptador local para ejecutar el CLI de npm. En Chrome se revisaron el inicio de sesión y el editor de socios a 1440 y 390 píxeles con datos ficticios, incluidos el foco en errores y la reducción de movimiento.

## Cómo retomar

Revisar la rama remota y los cambios locales antes de publicar. Con autorización vigente, verificar la versión y el commit servido por `/api/health` después de la publicación.

El contexto está disponible en el repositorio; no se creó automáticamente una sesión de trabajo en otra aplicación ni se transfirieron accesos de GitHub, Render o Notion. Esas conexiones dependen del entorno de destino.
