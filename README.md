# FITWare · Versión 3.0

Aplicación local de gestión para organizaciones con uno o varios gimnasios. React + TypeScript, Node.js + Express y PostgreSQL (embebido con PGlite o servidor externo).

## Novedades de esta entrega

- **Búsqueda siempre visible** por nombre o DNI en la sede actual. Abrí una ficha desde cualquier pantalla, también con `Ctrl+K` / `⌘K`, flechas y Enter.
- **Alta y primer cobro juntos**: elegí actividades y “Crear socio y cobrar ahora”, revisá importe y fechas y confirmá. Si algo falla no queda un alta incompleta. También podés guardar sin cobrar.
- **Renovar igual** recupera los planes, participantes del 2x1, medio de pago y descuentos permitidos del último cobro válido. Se usan precios actuales. Si la promoción venció o falta autorización, se muestra una advertencia. Nunca se cobra con un clic: primero se revisan total y vencimientos. “Actualizar total y fechas” permite recalcularlos.
- **Ficha más clara**: estado, próximo vencimiento, actividades y último pago primero; contacto, emergencia e historial en apartados desplegables.
- **Anular movimientos con motivo** desde Pagos, Caja o Balances. El permiso `movements.void` se otorga explícitamente a empleados; el dueño lo tiene siempre. Se conserva el historial, se corrigen los balances y se cancelan las suscripciones del cobro. Una venta devuelve sus unidades al stock una sola vez. En cobros con combo/2x1 se anula toda la orden. Si hay renovaciones posteriores, se anulan primero las más recientes. Anular un egreso corrige su registro de caja; no elimina físicamente mercadería ni ejecuta una devolución de dinero.
- **Importar Excel/CSV** desde Socios: plantilla descargable con actividades disponibles, vista previa por fila, duplicados y errores. Máximo 500 filas y 2 MB. No sobrescribe socios ni genera pagos; solo confirma las filas válidas, con una nueva comprobación antes de guardar.
- **Alertas con acciones** para vencimientos de los próximos 7 días y productos que llegan al mínimo de stock configurable.
- **Configuración** reúne equipo/permisos, promociones, gimnasios y servicio. El dueño activa consumibles, promociones y múltiples gimnasios. Las organizaciones nuevas comienzan con esas funciones opcionales desactivadas; las ya existentes conservan sus funciones y datos. No se puede desactivar múltiples gimnasios si ya hay más de una sede.
- **Recuperar contraseña** con enlace de un uso por 30 minutos y cierre de las sesiones previas. Funciona con buzón local o remitente SMTP configurado; no se enviaron emails reales en esta entrega.
- **Respaldos automáticos** cada 24 horas mientras corre el servidor, con descarga para el dueño, comprobación de integridad y comando de restauración en una base nueva.

Se mantienen las promociones específicas 2x1/combo, el stock contado con historial, las pantallas separadas de caja y balances y la suscripción de USD 15 convertida a ARS. El alias informado es **el alias configurado en el módulo de suscripción** y el CVU **[configurado en el módulo de suscripción]**. La suscripción de FITWare sigue pendiente de credenciales comerciales. La web ya está publicada con HTTPS; los cobros del gimnasio usan una conexión independiente.

### Actualizar desde v2 o v2.1

Detené la aplicación y hacé una copia de tu carpeta completa antes de actualizar. Conservá **`.env`, `apps/api/.data` y `apps/api/.backups`**; si configuraste rutas propias, conservá también esas carpetas. Reemplazá el código y ejecutá `npm ci` y `npm run dev`. No hace falta repetir `setup`. La migración se ejecuta al iniciar, conserva usuarios, socios, cobros, stock y promociones y agrega los campos nuevos dentro de una transacción.

## Empezar en Windows

Necesitás Node.js **22.12 o superior**. Se probó con Node 24.

1. Extraé el ZIP y abrí la carpeta `fitware` en VS Code.
2. En Terminal → Nueva terminal:

```powershell
npm ci
npm run setup
npm run dev
```

3. Abrí **http://localhost:5173**.
4. `setup` muestra las credenciales generadas para dueño y recepción. También podés elegir **“Creá tu cuenta”** en el inicio para registrar otra organización y su primer gimnasio.

Cada cuenta nueva obtiene un período inicial de 14 días. En modo local, el bloqueo por suscripción está desactivado y no se cobran importes reales.

Los datos persisten en `apps/api/.data/postgres`. No necesitás instalar PostgreSQL ni Docker para probar. `Ctrl+C` detiene los servidores. Todo se prepara en la carpeta del proyecto; no se modifica tu computadora fuera de ella.

## Actualizar desde la versión 1

**Primero detené la aplicación y hacé una copia de tu carpeta `fitware` completa.** No sobrescribas ni borres tu `.env` ni `apps/api/.data`.

Reemplazá el código por el del ZIP nuevo, conservando esos dos elementos, y ejecutá:

```powershell
npm ci
npm run dev
```

No necesitás volver a ejecutar `setup`; si lo hacés, respeta el `.env` existente. La migración se ejecuta al iniciar, dentro de una transacción, y conserva socios, usuarios, pagos y vencimientos existentes. La prueba de actualización v1→v2 verifica estos datos. La organización inicial se llama “Mi organización” y su sede “Mi gimnasio”.

Los planes anteriores de **30 días** pasan a renovarse por **mes calendario** en los próximos cobros. Los de otras duraciones conservan sus días. No se recalculan las cuotas ya pagadas ni se alteran sus vencimientos históricos. Si preferís que un plan anterior siga durando exactamente 30 días, elegí “Cantidad personalizada de días” al editarlo.

## Funciones nuevas

| Pedido                     | Implementación                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registro                   | Alta pública del dueño, organización y primer gimnasio; ingreso con sesión HttpOnly.                                                                                                                                                                                 |
| Cobro mensual de FITWare   | Pantalla de servicio, prueba de 14 días, órdenes de pago, checkout de Mercado Pago, validación de notificaciones y habilitación por mes calendario. Precio definido en USD 15, convertido a ARS. La conexión real está pendiente de credenciales y despliegue HTTPS. |
| Consumibles                | Bebidas, snacks, suplementos y otras categorías; catálogo, costos, reposiciones, stock, ventas y egresos asociados.                                                                                                                                                  |
| Mes calendario             | Valor predeterminado; duración en días sigue disponible.                                                                                                                                                                                                             |
| Más de un gimnasio         | Varias sedes por organización, selector de gimnasio y datos separados. Reporte consolidado para el dueño.                                                                                                                                                            |
| Mi perfil                  | Nombre, contacto, dirección, rol, permisos y cambio de contraseña propia.                                                                                                                                                                                            |
| Empleados                  | Recepcionistas y entrenadores, sedes asignadas, contraseña inicial y permisos personalizables por el dueño.                                                                                                                                                          |
| Actividades al crear socio | Selección múltiple; se puede guardar pendiente o crear y cobrar en una sola operación.                                                                                                                                                                               |
| Datos de emergencia        | Dirección, nombre y teléfono del contacto de emergencia.                                                                                                                                                                                                             |
| Promociones                | 2x1 entre dos socios; combos de actividades; descuentos por porcentaje o importe; planes requeridos, vigencia e inactivación.                                                                                                                                        |
| Reportes                   | Filtros por período y sede, consolidado, comparación por actividad, evolución diaria, tabla detallada, movimientos y exportación CSV.                                                                                                                                |

El cobro de FITWare es un ingreso para quien presta el software. Las cuotas de socios y ventas de productos son movimientos del gimnasio. **No se mezclan entre sí.**

## Cómo se usa

1. Registrate o ingresá como dueño.
2. En **Configuración**, activá múltiples gimnasios y luego, en **Mis gimnasios**, creá las sedes que necesitás; elegí la sede activa en el selector de la barra lateral.
3. En **Planes**, creá las actividades con precio y duración.
4. En **Socios**, cargá datos personales, contacto de emergencia y uno o varios planes.
5. Desde su ficha, elegí **Cobrar actividades**; podés seleccionar varios planes, aplicar una promoción y ver el total antes de confirmar.
6. En **Configuración → Equipo y permisos**, creá empleados y asignales sedes y permisos. Cambiar el rol carga permisos sugeridos, que podés ajustar.
7. En **Consumibles**, creá productos, reponé stock y registrá ventas.
8. En **Caja**, consultá el día actual; en **Resumen y balances**, elegí otro período y, como dueño, todas las sedes.

Una actividad elegida en la ficha es una intención de inscripción: el estado vigente depende de una suscripción pagada. El alta no inventa cobros.

### Perfiles y permisos

El dueño tiene acceso completo a su organización; nunca a la de otro dueño. Los empleados solo ven las sedes asignadas. Se pueden habilitar por separado consulta/edición de socios, cobros, historial financiero, planes, stock, ventas, promociones, egresos y reportes.

Algunos permisos incluyen las consultas necesarias para usarlos: por ejemplo, cobrar requiere consultar socios y planes. El servidor agrega esas dependencias automáticamente. Solo el dueño administra empleados, abre sedes, consulta el consolidado y paga el servicio FITWare. Un entrenador no puede concederse permisos desde su propio perfil.

Los costos unitarios y los costos de ventas se ocultan a empleados sin permiso de administración de stock o reportes, según la operación. Guardar cambios en un empleado invalida sus sesiones. Cambiar tu contraseña cierra tus otras sesiones y conserva la actual.

### Renovación mensual

- Pago inicial el **1 de enero** → vence el **1 de febrero**.
- Pago el **31 de enero** → vence el último día de febrero → la renovación siguiente recupera el **31 de marzo**.
- La renovación anticipada agrega el período desde el vencimiento actual. Si ya venció, comienza el día del nuevo pago.
- El vencimiento es exclusivo: el socio está vigente hasta el día anterior. Se usa la fecha de Argentina.
- La duración personalizada sigue siendo de días corridos.

Cada cobro tiene una referencia única, se calcula nuevamente en el servidor y guarda cobro y suscripciones juntos. Si el precio cambió respecto al total mostrado, se rechaza y se debe revisar. Reenviar el mismo formulario no duplica la operación; abrir otro formulario es una operación nueva.

### Promociones

Al crear un **2x1**, seleccioná tipo, socio 1, socio 2 y una sola actividad. No se permite repetir al mismo socio ni usar clientes de otra sede. Al crear un **combo**, seleccioná un socio, dos o más actividades distintas y el descuento por porcentaje o importe. No se admite un combo formado por dos planes de la misma actividad.

Guardar la oferta no cobra ni activa cuotas. En su tarjeta se muestran los socios asociados; **“Aplicar y cobrar promoción”** abre el cobro con esos socios y actividades. El total se calcula en el servidor antes de confirmar, y el pago y las renovaciones se guardan juntos.

Si marcás **“Guardar como oferta general, sin socios fijos”**, creás una regla reutilizable. Al aplicarla se muestran los selectores correspondientes: dos socios y una actividad para el 2x1; un socio y varias actividades para el combo. Las ofertas de la versión 2 sin socios asignados se conservan como ofertas generales.

El 2x1 crea una orden y dos suscripciones. El ingreso neto se distribuye entre ambas filas para que los reportes sumen correctamente; no son dos cobros completos. Los descuentos pueden tener porcentaje o importe, fechas, actividades requeridas e inactivación. No se acumulan con descuentos manuales.

### Consumibles y balance

El stock se puede cargar inicialmente desde el producto, aumentar por reposiciones, disminuir por ventas o corregir por un recuento. Cada cambio deja un movimiento de inventario. No se admite stock negativo. Altas/ediciones de producto, ventas y reposiciones tienen referencias únicas para evitar duplicados por reenvíos. Un ajuste contado exige que el stock no haya cambiado desde que abriste el producto. Las ventas conservan precio y costo aunque se edite luego el producto. En la reposición se calcula un costo promedio ponderado, redondeado a centavos.

En el alta de producto, registrar el stock inicial como compra es opcional; sirve para distinguir existencias previas de una compra nueva. Al reponer, **“Registrar la compra como egreso”** está marcado por defecto. Desmarcalo solo para stock inicial o una compra registrada por otro lado. No vuelvas a cargar el mismo gasto manualmente.

El **balance de caja = cuotas cobradas + ventas cobradas − egresos registrados**. La columna “Costo vendido” es informativa: no vuelve a descontar una compra de stock ya registrada como egreso. Esta versión no calcula impuestos, amortizaciones ni cuentas a cobrar/pagar; el balance no se presenta como una ganancia contable neta ni como saldo bancario.

Los gráficos de actividad muestran **socios únicos con cuota vigente al cierre del período** o **ingresos de esa actividad**. No se inventan visitas: aún no hay control de asistencia. Un mismo socio puede estar vigente en dos actividades; los recuentos de actividades no son sumables como personas distintas. Las operaciones de actividades son filas cobradas por socio/plan; en consumibles se muestran unidades vendidas.

El CSV de balance incluye los mismos conceptos e importes que la tabla. Los CSV de caja y cuotas excluyen movimientos anulados. El historial en pantalla los conserva con su motivo. El CSV de cuotas identifica las filas relacionadas mediante el identificador de orden.

## Suscripción de USD 15 y Mercado Pago

El precio inicial es **USD 15 por mes calendario** para toda la organización, incluidas sus sedes. El pago se realiza en **pesos argentinos**, por Mercado Pago Checkout Pro, y lo inicia el dueño cada mes. **No hay débito automático.**

La conversión inicial usa **dólar oficial vendedor de DolarAPI**. Esto es una decisión de configuración explícita: no se usa dólar blue, MEP ni un precio histórico fijado en el código. La pantalla muestra el tipo de cambio, su fuente, su fecha de actualización, USD 15 y el total exacto en ARS antes de pagar.

Al actualizar el importe, el servidor consulta la fuente y guarda una cotización válida por **15 minutos**, asociada a esa cuenta. El importe y la referencia se recuperan de esa cotización al crear el checkout; el navegador no puede enviar un monto menor. El importe de esa orden queda reservado aunque luego cambie el dólar. En la siguiente renovación se vuelve a convertir USD 15.

La fuente puede tener fecha del último día hábil: se acepta una antigüedad máxima de **96 horas**, visible en pantalla. Se rechazan cotizaciones más antiguas, futuras o inválidas. Si no se puede consultar una cotización válida, el pago se deshabilita en lugar de inventar un importe.

### Destino informado

| Dato            | Valor                                     |
| --------------- | ----------------------------------------- |
| Alias           | Configurado en el módulo de suscripción   |
| CVU             | [configurado en el módulo de suscripción] |
| Moneda de cobro | ARS                                       |

Estos datos son visibles y se pueden copiar. No permiten verificar automáticamente el titular ni conectar la cuenta de Mercado Pago. El receptor real del checkout depende de las credenciales de la cuenta vendedora, que deben corresponder a estos datos. Todavía no se hizo esa comprobación ni se activaron cobros reales. Antes de pagar se debe revisar el titular mostrado por Mercado Pago; no se inventa un nombre verificado.

Una transferencia directa al alias/CVU **no habilita por sí sola** el servicio. La integración automática está preparada para confirmar pagos del checkout mediante notificaciones verificadas; no existe un botón del cliente para declarar una transferencia como aprobada.

### Activación pendiente

Faltan credenciales de la cuenta receptora, despliegue HTTPS autorizado y una prueba real de integración. No pegues secretos en React ni en el chat; se configuran en el entorno privado del servidor:

```dotenv
REQUIRE_SUBSCRIPTION=true
PUBLIC_URL=https://TU_DOMINIO
APP_ORIGIN=https://TU_DOMINIO
MP_ACCESS_TOKEN=TU_ACCESS_TOKEN_PRIVADO
MP_WEBHOOK_SECRET=TU_SECRETO_DE_NOTIFICACIONES
MP_COLLECTOR_ID=TU_ID_DE_VENDEDOR
MP_ALLOW_TEST_PAYMENTS=false
NODE_ENV=production
```

En modo local dejá `REQUIRE_SUBSCRIPTION=false`. La variable antigua `SERVICE_MONTHLY_CENTS` ya no se utiliza: el precio se convierte desde USD 15 en cada cotización.

Configurá las notificaciones de pagos en `https://TU_DOMINIO/api/billing/webhook`. Se valida la firma con el SDK oficial y se consulta el pago en la API autenticada; luego se comprueban referencia, importe en ARS, moneda y vendedor. Volver a `?billing=success` no habilita una cuenta y reenviar una notificación no agrega meses. Los reembolsos/contracargos invalidan el recibo correspondiente; las disputas requieren conciliación del proveedor del servicio.

Fuentes de la integración:

- [DolarAPI: dólar oficial y formato de respuesta](https://dolarapi.com/docs/argentina/operations/get-dolar-oficial)
- [Endpoint de cotización consultado](https://dolarapi.com/v1/dolares/oficial)
- [Mercado Pago: preferencias de Checkout Pro](https://www.mercadopago.com.ar/developers/en/reference/online-payments/checkout-pro-preferences/overview)
- [Mercado Pago: notificaciones](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-preferences/payment-notifications)

## PostgreSQL externo (opcional)

Sin `DATABASE_URL`, se usa PGlite local. Para conectar un servidor real, definí:

```dotenv
DATABASE_URL=postgres://USUARIO:CONTRASENA@localhost:5432/fitware
```

`compose.yaml` incluye PostgreSQL 17 para quien ya tenga Docker. Definí `POSTGRES_PASSWORD` en `.env`, configurá la URL equivalente y ejecutá `docker compose up -d db`. Docker no se instala automáticamente. Cambiar de modo no migra los datos entre bases.

## Recorrer el código para aprender

```text
apps/web/src/
  main.tsx        Punto de entrada de React
  app.tsx         Navegación, registro/login, sedes y pantallas
  workspace-tools.tsx Búsqueda, ficha, importación, configuración y recuperación
  editor.tsx      Formularios, selección múltiple y cotización de cobros
  reports.tsx     Gráficos, filtros, resumen y movimientos
  cash.tsx        Libro diario y flujo por medio de pago
  billing-panel.tsx Destinatario, USD 15 y cotización en ARS
  components.tsx  Componentes visuales reutilizables
  api.ts          Fetch, encabezado de sede, fechas, moneda y CSV
  types.ts        Contratos TypeScript
  styles.css      Estilos adaptables
apps/api/src/
  server.ts       Arranque y cierre del servidor
  app.ts          API, autorización, datos por sede y reportes
  domain.ts       Promociones, cálculo exacto y transacción del cobro
  dates.ts        Mes calendario, anclas y fecha de Argentina
  billing.ts      Checkout del software y validación de pagos
  exchange.ts     Precio USD, conversión y cotizaciones de 15 minutos
  db.ts           PostgreSQL/PGlite y migración v1→v2
  member-flows.ts Alta con cobro, renovación y anulaciones
  import-members.ts Plantilla, validación previa y confirmación de importaciones
  recovery.ts     Enlaces privados y envío por buzón local o SMTP
  backups.ts      Copias por organización, integridad y restauración
  restore.ts      Comando de restauración
  features.ts     Módulos opcionales y registro de acciones
  security.ts     Contraseñas y tokens
  seed.ts         Inicialización local y permisos sugeridos
apps/api/test/
  app.test.ts     Integración, permisos, promociones, stock y facturación
  flows.test.ts   Altas/cobros, anulaciones, importación, recuperación y restauración
apps/web/test/
  ui.test.tsx     Pruebas de renderizado de formularios y pantallas
  interactions.test.tsx Interacciones React contra Express y PostgreSQL en memoria
scripts/
  setup.mjs       Credenciales locales aleatorias
  dev.mjs         Arranque de API y frontend
```

Para entender un flujo completo, seguí **Registrar cobro**: `editor.tsx` envía la selección a `/payments/quote`; Express comprueba permisos y sede; `domain.ts` calcula la promoción; al confirmar, otra petición verifica el total y crea todo dentro de una transacción. React consulta de nuevo los datos guardados.

## Recuperación de cuentas

En local, **Olvidé mi contraseña** genera un archivo privado en `apps/api/.data/mail`. El administrador abre ese archivo en su servidor y usa el enlace; no es una bandeja de correo enviada al cliente. Es el modo predeterminado fuera de producción cuando no hay SMTP configurado. Los enlaces no aparecen en respuestas públicas de la API.

Para enviar emails reales, configurá en `.env` un remitente propio:

```dotenv
MAIL_MODE=smtp
SMTP_HOST=TU_SERVIDOR
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=TU_USUARIO
SMTP_PASSWORD=TU_SECRETO
SMTP_FROM=FITWare <acceso@TU_DOMINIO>
APP_ORIGIN=https://TU_DOMINIO
```

Para SMTP en puerto 465, usá `SMTP_SECURE=true`. En producción se exige HTTPS y no se admite el buzón local. `MAIL_MODE=off` deshabilita las solicitudes de enlace. Los secretos van solo en el servidor. Se verificaron enlaces, expiración, uso único y cierre de sesiones con un remitente simulado; falta comprobar la entrega con tu proveedor real.

## Respaldos y restauración

El servidor revisa al arrancar y cada hora si corresponde un respaldo: crea uno si no existe o pasaron 24 horas. Las copias se guardan en `apps/api/.backups/<organización>`. Desde **Configuración → Copias de seguridad**, el dueño puede crear una manual y descargar las últimas diez. La descarga solo permite respaldos de su organización y valida SHA-256. Si el servidor está apagado no se generan copias; al volver a arrancar se comprueba el último respaldo.

Cada `.json.gz` incluye la organización, sedes, usuarios, permisos, contraseñas cifradas mediante hash, socios, planes, promociones, stock, movimientos, fotos, credenciales QR con hash, acreditaciones, ingresos y arqueos. No incluye sesiones ni enlaces de recuperación, ni archivos de `.env`. El archivo está comprimido, **no encriptado**: guardalo en un lugar privado y descargá una copia fuera del servidor. En el plan gratuito de Render los archivos de respaldo son temporales y pueden desaparecer al reiniciar o desplegar; las fotos operativas se guardan en PostgreSQL. No hay borrado automático de respaldos en esta versión.

### Restaurar sin sobrescribir una base existente

1. Detené la aplicación y conservá una copia de `.env` y de tu base actual.
2. En `.env`, elegí un directorio nuevo para PostgreSQL embebido, por ejemplo `DATA_DIRECTORY=.data/restaurado-2026`. Esa ruta es relativa a `apps/api`. Dejá `DATABASE_URL` sin definir para usar el modo embebido y poné `SEED_DEMO=false`.
3. Desde la carpeta `fitware`, ejecutá con la ruta absoluta de tu respaldo:

```powershell
npm run restore -- "C:\Respaldos\FITWare-respaldo.json.gz"
npm run dev
```

4. Ingresá con el email y la contraseña que tenías cuando se creó el respaldo. Se restauran los datos de esa organización; las sesiones se vuelven a crear al ingresar.

El comando comprueba formato y referencias y restaura dentro de una transacción. Rechaza una base con usuarios o datos operativos para impedir que se sobrescriba información. Para PostgreSQL externo, apuntá `DATABASE_URL` a una **base nueva** antes del comando. Un respaldo de organización no es una copia conjunta de todos los clientes del servicio. Para respaldar una instalación completa con varias organizaciones, mantené también una copia de la base completa con la aplicación detenida o las herramientas de tu servidor PostgreSQL.

## Validación y límites

```powershell
npm run build
npm test
npm run format
```

Las pruebas cubren TypeScript, compilación de React, API con PostgreSQL embebido, actualizaciones de esquema, aislamiento de organizaciones/sedes, permisos, meses calendario, promociones, concurrencia, stock, balances y reglas internas de habilitación del servicio.

También se recorre con React Testing Library la aplicación contra Express y una base real en memoria: crear socio con pago, buscar desde otra pantalla, renovar, anular con motivo, abrir caja/balances/configuración, respaldar y consultar la ficha con permisos de entrenador. Se ejecuta con tamaños de ventana DOM de 1440 y 390 píxeles. Se comprueban además la vista previa de importación y los formularios de recuperación. **Estas pruebas no verifican el diseño renderizado por un navegador ni un dispositivo físico.**

La web está desplegada en Render con PostgreSQL externo. Las pruebas automatizadas usan PostgreSQL embebido; no se realizó una compra real/sandbox de Mercado Pago ni una entrega SMTP real. Se probó crear, descargar y restaurar un respaldo en una base vacía, además de rechazar restauraciones sobre datos existentes.

La versión publicada está en https://fitware-3olk.onrender.com. El historial de cuotas pagina y busca en el servidor. La búsqueda general usa los socios cargados de la sede. Incluye recepción con QR, foto e intentos de ingreso; no conecta molinetes físicos, rutinas ni facturación fiscal. Las conexiones de pagos y correo reales requieren configuración y pruebas con los proveedores.

## Publicación en Render

Servicio: https://fitware-3olk.onrender.com · repositorio: https://github.com/GuiCon5k/Fitware

- Build Command: `npm ci --include=dev && npm run build`
- Start Command: `npm start`
- Health Check Path: `/api/health`
- Variables: `NODE_ENV=production`, `APP_ORIGIN=https://fitware-3olk.onrender.com`, `PUBLIC_URL=https://fitware-3olk.onrender.com`, `SEED_DEMO=false`, `REQUIRE_SUBSCRIPTION=false`, `MAIL_MODE=off`, `NODE_VERSION=24`.
- `DATABASE_URL`: conexión privada de una base PostgreSQL persistente, configurada solo en Render. El arranque de producción rechaza su ausencia para evitar guardar socios en un disco temporal.
- `BACKUP_DIRECTORY`: directorio de un volumen persistente, o integrar almacenamiento externo antes de confiar en respaldos automáticos. Las copias en el disco temporal de Render no son durables.
- Si no se define `ADMIN_PASSWORD`, producción no crea las cuentas de ejemplo. El dueño se registra desde la interfaz con su propia contraseña.

No se activan pagos reales ni SMTP hasta configurar y probar sus credenciales. El plan gratuito actual del servicio no constituye una configuración con persistencia garantizada. Elegir y aprobar los recursos persistentes antes de cargar datos reales. Cambiar los comandos de un servicio creado manualmente se realiza en Settings de Render.

## Registro y validación de formularios

El registro exige repetir la contraseña y comprueba la coincidencia tanto en React como en Express. Los campos de contraseña incluyen controles accesibles para mostrar/ocultar su contenido en registro, ingreso, cambio, recuperación y empleados. Las contraseñas no se recortan ni normalizan.

La API normaliza espacios externos y Unicode de los textos de formularios JSON y parámetros de consulta, y convierte los emails a minúsculas. Rechaza caracteres de control, claves de prototipo y estructuras excesivas; los esquemas por operación verifican formatos, límites, números, fechas y opciones. La importación valida sus textos con los mismos esquemas de socios. El webhook de Mercado Pago conserva el contenido original para su validación específica. Los mensajes de validación se devuelven en español, con nombres de campo y un mapa `fields`.

Los nombres y las observaciones conservan apóstrofes, acentos y texto literal: React los muestra escapados, no como HTML. SQL continúa usando parámetros y los CSV neutralizan prefijos de fórmula, incluidos los precedidos por espacios. Esto es validación y manejo contextual de entradas, no una garantía general de ausencia de vulnerabilidades ni una auditoría completa de seguridad.

## Mejoras a partir de la recepción de un gimnasio (4.0)

El escenario de trabajo es de unos 500 pases mensuales entre altas y renovaciones. El historial presenta fecha, nombre, DNI, teléfono, pase, precio final, forma de pago, referencia y promoción. Busca en servidor y pagina de a 50 filas; descargar Excel respeta fechas, búsqueda y medio, e incluye estado y número de cobro. Un combo o 2x1 tiene una orden y varias filas de pases: se distribuyen precio y descuento sin duplicar ingresos. Las filas anuladas se conservan y se excluyen de los totales confirmados. El contacto y DNI reflejan la ficha actual; importes, planes y medios conservan su snapshot.

### Cobros, consumibles y acreditaciones

- En **Pagos y suscripciones → Administrar formas de pago**, el dueño crea medios específicos (banco, billetera, débito, crédito, QR). Se usan también al vender, reponer stock y registrar egresos. Cada operación conserva el nombre y la referencia aunque luego se desactive el medio. El grupo contable es efectivo o electrónico; no se calculan comisiones ni fechas de liquidación de tarjetas.
- En un cobro electrónico, “Dejar pendiente hasta verificar la acreditación” guarda una intención que **no activa pases ni ingresa a caja**. Se revisa en la bandeja de acreditaciones. Confirmación manual y verificación por Mercado Pago quedan diferenciadas, con operador y motivo. Rechazar no crea un pago. La confirmación vuelve a cotizar, muestra vencimientos, exige que el importe no haya cambiado y es atómica e idempotente.
- El alta con primer pago supone un cobro recibido. Para una transferencia pendiente, guardá primero al socio sin cobrar y luego informá el cobro pendiente.
- Los egresos enviados por la interfaz ahora también tienen referencia idempotente para evitar duplicados al reintentar.

### Cuenta de Mercado Pago del gimnasio

La conexión para **cuotas del gimnasio** es distinta de las variables `MP_*` que cobran la suscripción de FITWare. Se configura de forma privada en el servidor, nunca en el frontend ni en el repositorio:

| Variable              | Uso                                                                      |
| --------------------- | ------------------------------------------------------------------------ |
| `GYM_MP_GYM_ID`       | ID de la sede cuyo receptor se está conectando. No habilita otras sedes. |
| `GYM_MP_ACCESS_TOKEN` | Credencial privada de esa cuenta de Mercado Pago.                        |
| `GYM_MP_COLLECTOR_ID` | ID del receptor que debe devolver Mercado Pago.                          |

Esta primera conexión admite una sede por despliegue; las demás conservan la conciliación manual. Al revisar un pendiente, el dueño puede consultar el número de operación por la API oficial. Se validan receptor, ARS, estado aprobado, importe exacto, ausencia de devolución, fecha de aprobación próxima al pendiente y operación no usada antes. En producción se rechazan operaciones de prueba. La asignación al socio la revisa el operador; no se deduce solo por importe. La verificación es puntual, no una sincronización continua de reembolsos/contracargos. Solo aplica a operaciones accesibles por Payments API: una transferencia personal a CVU puede requerir confirmación manual. No se hicieron cobros reales ni se activó esta conexión sin credenciales.

Referencia: [Mercado Pago — consultar un pago](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-payment/get).

### Arqueo y recepción

- **Caja y movimientos → Arqueo:** saldo inicial en efectivo, esperado por medio, contado/acreditado y diferencia. Se exige explicación si hay diferencias. Cada revisión queda guardada, sin sobrescribir la anterior; si cambia un cobro o anulación, se detecta que debe revisarse de nuevo. No bloquea el día. El saldo inicial corresponde a la fila Efectivo; si se crean otros medios de efectivo, no hay que contar los mismos billetes dos veces.
- **Ingresos:** búsqueda por DNI/nombre, lector QR USB que escribe como teclado y cámara en navegadores con `BarcodeDetector`. Si no está disponible o falta permiso de cámara, funciona la búsqueda manual. Se muestra la foto y la vigencia de cada actividad; el servidor vuelve a validar al registrar. Se agrupan reintentos dentro de 60 segundos por socio, área y resultado. No depende de un PIN enviado ni abre un molinete.
- En **ficha del socio**, foto JPG/PNG hasta 2 MB, normalizada y guardada en PostgreSQL; el dueño o personal autorizado puede crear, renovar o revocar una credencial QR. Al renovar se invalida la anterior; el token solo se entrega en ese momento y en la base queda su hash. No contiene DNI. La lectura de fotos y credenciales exige sesión, sede y permisos.
- El filtro Activo/Vencido se calcula para la actividad elegida. El DNI se corrige desde Editar datos / DNI, conservando historial y registrando el cambio. Las promociones se ven en la navegación, la cotización, la ficha y el historial.
- **Resumen y balances** agrega ingresos registrados por área y socios únicos, separados de la cantidad de socios con pase vigente. “Ingreso general” no se atribuye a todas las actividades del socio.

Permisos adicionales: `payments.reconcile`, `cash.count`, `access.checkin`, `access.manage`. El dueño conserva acceso completo; las recepciones nuevas incluyen control de ingresos. Los permisos personalizados anteriores no se amplían automáticamente. El dueño puede asignarlos en Mi equipo.

### Revisión y compatibilidad

La migración de esquema 5 es aditiva y mantiene los datos anteriores. Los respaldos nuevos incluyen las tablas agregadas; el restaurador también acepta respaldos de esquema 4. Se verifican cobros duplicados/concurrentes, permisos, aislamiento entre sedes, montos de promociones, costo y stock, vigencias exclusivas, anulaciones, restauración y un historial de 500 pases. El health check consulta la base y expone la versión desplegada sin credenciales.

### Dependencias revisadas

Se actualizaron Express y body-parser (2.4.0), corrigiendo la alerta alta del procesamiento de solicitudes comprimidas. npm audit de producción conserva dos alertas moderadas vinculadas a uuid transitivo de ExcelJS. El aviso afecta las funciones v3/v5/v6 con buffers externos; ExcelJS usa únicamente v4 sin esos buffers, según la revisión del código de esta versión. No se aplicó el downgrade incompatible de ExcelJS que propone `npm audit fix --force`. Referencias: [aviso body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828) y [aviso uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq). La ausencia de alertas en npm audit no equivale a una auditoría completa de seguridad.
