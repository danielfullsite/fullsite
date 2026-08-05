FULLSITE POS -- KIT DE CERTIFICACION EN CAMPO
=============================================
Version    : 1.0.0
Fecha      : 2026-08-05
Plataforma : Windows 10/11 (x64)
Maquinas   : PDV3 (terminal punto de venta) y SERVER1 (Bridge)

CONTENIDO
---------
  CERT-CAPTURE.ps1       -- Script de captura de evidencia (solo lectura)
  RUN-CERT-CAPTURE.cmd   -- Lanzador con doble clic (pide permisos de admin)
  PRE-INSTALL-BACKUP.ps1 -- Respaldo restaurable ANTES de instalar
  INSTALL.cmd            -- Instalacion con respaldo, firewall y log
  FIREWALL-SETUP.ps1     -- Reglas de firewall del Bridge (7717 / 5353)
  ROLLBACK.ps1           -- Regresar la maquina al estado del respaldo
  README.txt             -- Este archivo

  OJO: CERT-CAPTURE nunca cambia nada. INSTALL.cmd, FIREWALL-SETUP.ps1 y
  ROLLBACK.ps1 SI cambian el sistema — usarlos solo cuando el runbook
  (seccion "Instalacion controlada") lo indique.

QUE HACE
--------
Cada vez que lo ejecutas, toma una "foto" del estado del sistema y la
guarda en una carpeta nueva con fecha y hora. NO cambia nada:

  - Fecha y hora exactas de la captura
  - Puertos 7717 (Bridge) y 7718 (lector de huella)
  - Procesos de Fullsite corriendo
  - Respuesta del Bridge: /health, /state, /identity, /events
  - Eventos de ordenes y de cocina (KDS)
  - Cola de impresion (trabajos pendientes, impresos, fallidos)
  - Archivos de datos locales (tamano, fecha, huella SHA-256)
  - Estado de sincronizacion con la nube
  - Deteccion de duplicados (ordenes/eventos repetidos)
  - Lineas de ERROR en los logs del servidor
  - SUMMARY.txt con resultado PASS / WARN / FAIL de cada punto

LA CAPTURA (CERT-CAPTURE / RUN-CERT-CAPTURE) NO:
  X Imprime tickets ni abre el cajon
  X Detiene o modifica ningun proceso
  X Escribe en el registro de Windows
  X Cambia el firewall
  X Instala o desinstala nada
  X Modifica ordenes, mesas, turnos ni ningun dato del POS
  X Copia el archivo config.json completo (las llaves quedan REDACTADAS)

SALIDA
------
  (carpeta del kit)\evidence\MAQUINA-AAAAMMDD-HHMMSS-etiqueta\
    -- Todos los archivos de evidencia + SUMMARY.txt + transcript.log

COMO USARLO (OPERADOR)
----------------------
  1. Copia la carpeta completa FULLSITE-FIELD-KIT\ a un USB.
  2. Copia la carpeta del USB al Escritorio de la maquina (PDV3 o SERVER1).
  3. Cada vez que el runbook diga "capturar evidencia":
       a. Doble clic en  RUN-CERT-CAPTURE.cmd
       b. Clic en "Si" cuando Windows pida permisos de administrador
       c. Espera a que termine (menos de 1 minuto)
       d. Lee el bloque final: debe decir OVERALL : PASS
       e. Si dice FAIL: NO continues; avisa al responsable tecnico
  4. Para etiquetar la captura con el paso del runbook, abre una ventana
     de comandos (cmd) en la carpeta del kit y escribe por ejemplo:

       RUN-CERT-CAPTURE.cmd paso07-orden

     (la etiqueta aparece en el nombre de la carpeta de evidencia)
  5. Al final del dia, copia TODA la carpeta evidence\ al USB.

USO AVANZADO (TECNICO)
----------------------
  Directo en PowerShell:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\CERT-CAPTURE.ps1 -Label paso07-orden

  Capturar tambien el Bridge remoto (desde PDV3 hacia SERVER1):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\CERT-CAPTURE.ps1 -Label paso23-multi -RemoteBridge IP_DE_SERVER1

  Consultar el Bridge a mano (solo lectura):
    powershell -Command "Invoke-RestMethod http://127.0.0.1:7717/health | ConvertTo-Json -Depth 5"

INTERPRETACION DEL SUMMARY
--------------------------
  PASS  -> Punto verificado correctamente.
  WARN  -> Informativo. Puede ser normal a mitad de prueba (por ejemplo,
           impresora desconectada a proposito, o sin internet todavia).
  FAIL  -> Detente. FAIL en PORT_7717_LISTENING, HEALTH_OK o
           ZERO_DUPLICATES es un P0: usa la plantilla P0 del runbook
           THURSDAY-RUNBOOK.md y no avances al siguiente paso.

INSTALACION Y ROLLBACK (SOLO CUANDO EL RUNBOOK LO PIDA)
-------------------------------------------------------
  Estos pasos SI cambian la maquina. Seguir el orden del runbook,
  seccion "Instalacion controlada".

  1. INSTALAR / ACTUALIZAR la app:
       a. Cierra la app si esta abierta (Ctrl+Shift+Q).
       b. En cmd, desde la carpeta del kit:

            INSTALL.cmd "D:\usb\Fullsite POS Setup 1.3.3.exe"

          (la ruta es la del instalador en tu USB)
       c. El script hace TODO solo: respaldo verificado, instalacion
          silenciosa, firewall y primer arranque de la app.
       d. Si el respaldo falla, la instalacion se cancela sola. Avisa
          al responsable tecnico.
       e. Al terminar: RUN-CERT-CAPTURE.cmd install
       f. Guarda: la carpeta backups\ y el archivo de install-logs\.

  2. RESPALDO SUELTO (sin instalar): doble clic no aplica; en cmd:
       powershell -NoProfile -ExecutionPolicy Bypass -File .\PRE-INSTALL-BACKUP.ps1
     El resultado queda en backups\MAQUINA-FECHA\ con BACKUP-INFO.txt
     (debe decir RESULT : VERIFIED).

  3. FIREWALL solo (si la otra maquina no alcanza el puerto 7717):
       powershell -NoProfile -ExecutionPolicy Bypass -File .\FIREWALL-SETUP.ps1
     Para quitar las reglas:  ...\FIREWALL-SETUP.ps1 -Remove

  4. ROLLBACK (regresar todo como estaba) -- SOLO con autorizacion
     del responsable tecnico:
       powershell -NoProfile -ExecutionPolicy Bypass -File .\ROLLBACK.ps1 -BackupDir ".\backups\MAQUINA-FECHA"
     Te pide escribir SI antes de borrar nada. Al final revisa que
     diga ROLLBACK VERIFIED, reinicia la maquina y corre:
       RUN-CERT-CAPTURE.cmd rollback

SOLUCION DE PROBLEMAS
---------------------
  Error de "Execution Policy"
    -> Ejecuta con RUN-CERT-CAPTURE.cmd (usa -ExecutionPolicy Bypass)

  "Acceso denegado" en algunas lecturas
    -> Normal sin admin; el script continua y registra lo que puede.
    -> Siempre usa RUN-CERT-CAPTURE.cmd, que pide admin.

  /health no responde (HEALTH_OK = FAIL)
    -> Verifica que la app Fullsite POS este abierta en esa maquina.
    -> El Bridge corre dentro de la app (puerto 7717).

  La carpeta evidence\ no aparece
    -> Se crea junto al script, no en el Escritorio.
    -> Revisa transcript.log dentro de la carpeta de evidencia parcial.
