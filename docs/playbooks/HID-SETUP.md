# HID DigitalPersona 4500 — Guia de Configuracion para Fullsite POS

## Resumen

El lector de huellas HID DigitalPersona 4500 funciona con Fullsite POS a traves de la cadena:

```
Lector USB DP4500 -> Driver WBF -> Windows Hello -> WebAuthn (Chrome) -> Fullsite POS
```

El lector NO es un dispositivo FIDO2 nativo. Requiere el driver WBF (Windows Biometric Framework) para integrarse con Windows Hello, que a su vez actua como autenticador de plataforma para WebAuthn en Chrome.

## Requisitos

- Windows 10 o Windows 11
- Google Chrome actualizado (67+)
- HID DigitalPersona 4500 conectado por USB
- Driver WBF instalado (ver abajo)
- Windows Hello configurado con huella digital

## 1. Instalar Driver WBF (Windows Hello)

### Opcion A: Windows Update (recomendada)

1. Conectar el lector DigitalPersona 4500 al puerto USB
2. Reiniciar la computadora con el lector conectado
3. Ir a **Configuracion > Windows Update > Buscar actualizaciones**
4. Si no aparece automaticamente, revisar **Actualizaciones opcionales** — el driver puede estar ahi
5. Instalar y reiniciar de nuevo

### Opcion B: Descarga manual desde HID Global

1. Ir a: https://www.hidglobal.com/drivers/39477
2. Descargar **U.are.U Fingerprint Reader Driver (WBF) v5.0.0.5**
3. Ejecutar el instalador como administrador
4. Reiniciar la computadora

### Verificar instalacion

1. Ir a **Administrador de dispositivos** (devmgmt.msc)
2. Buscar bajo **Dispositivos biometricos** (Biometric devices)
3. Debe aparecer: **DigitalPersona U.are.U 4500 Fingerprint Reader**
4. Si tiene un triangulo amarillo, el driver no esta instalado correctamente

**IMPORTANTE:** No instalar el driver "Non-WBF" (disponible en hidglobal.com/drivers/46502) ya que ese NO es compatible con Windows Hello.

## 2. Configurar Windows Hello con Huella Digital

1. Ir a **Configuracion > Cuentas > Opciones de inicio de sesion**
2. En la seccion **Huella digital** (Fingerprint recognition), hacer clic en **Configurar**
3. Se pedira crear un PIN de Windows primero (si no existe uno)
4. Colocar el dedo en el lector DigitalPersona cuando se indique
5. Tocar varias veces siguiendo las instrucciones (8-10 toques)
6. Registrar al menos 2 dedos (indice derecho + indice izquierdo recomendado)

### Verificar que funciona

1. Presionar **Win + L** para bloquear la sesion
2. Colocar el dedo registrado en el lector
3. Debe desbloquear Windows sin necesidad de escribir contrasena

## 3. Registrar Huella en Fullsite POS

Una vez que Windows Hello funciona con el lector:

1. Abrir Chrome e ir a https://app.fullsite.mx/pos
2. Ingresar el PIN del empleado normalmente
3. Al entrar, aparecera la pantalla **"Registrar huella"**
4. Tocar el boton **"Registrar huella"**
5. Chrome mostrara un dialogo de Windows Hello — colocar el dedo en el lector
6. Si sale exitoso, aparece **"Huella registrada"** en verde
7. La proxima vez, el empleado puede entrar directamente con huella (sin PIN)

### Si el empleado quiere saltar

- Hay un boton **"Saltar por ahora"** — entra directo al POS
- La proxima vez que entre con PIN, se le volvera a ofrecer registrar huella

### Registrar varios empleados

Cada empleado debe:
1. Entrar con su propio PIN
2. Registrar su propia huella en el dialogo de Windows Hello
3. La credencial queda ligada a su staff ID

Windows Hello soporta multiples huellas de diferentes personas en la misma terminal.

## 4. Uso Diario

### Login con huella
1. En la pantalla de login del POS, tocar **"Entrar con huella"**
2. Colocar el dedo en el lector
3. Acceso inmediato al POS

### Login con PIN (fallback)
- Si la huella no funciona, siempre se puede usar el PIN
- El campo de PIN esta disponible debajo del boton de huella

## 5. Troubleshooting

### "No aparece el boton de huella en el POS"

Causas posibles:
- Windows Hello no esta configurado con huella digital
- El driver WBF no esta instalado (se instalo el Non-WBF)
- Chrome no soporta WebAuthn (version muy vieja)

Solucion: verificar que Windows Hello funciona primero (bloquear/desbloquear con huella)

### "El lector parpadea pero no registra"

- Limpiar el lector con un pano seco
- Asegurarse de que el dedo cubra toda la superficie del sensor
- Probar con otro dedo
- Verificar que el cable USB esta bien conectado

### "Error al registrar huella en Chrome"

Posibles causas:
- El sitio no es HTTPS (WebAuthn requiere HTTPS o localhost)
- Windows Hello no tiene huellas registradas
- Pop-up bloqueado por Chrome

Solucion:
1. Verificar que la URL sea `https://app.fullsite.mx/pos`
2. Configurar al menos una huella en Windows Hello primero
3. Permitir pop-ups de app.fullsite.mx

### "La huella funcionaba antes pero ya no"

- Si se borro localStorage del navegador, las credenciales se pierden
- Solucion: registrar huella de nuevo despues de entrar con PIN
- Si se reinstalo Windows o cambio de terminal, hay que repetir todo el setup

### "Windows Hello no detecta el lector DP4500"

1. Desconectar y reconectar el USB
2. Probar en otro puerto USB
3. Verificar en Administrador de dispositivos que aparece sin errores
4. Si tiene triangulo amarillo: desinstalar dispositivo, reiniciar, dejar que Windows reinstale el driver
5. Si persiste: descargar el driver WBF manualmente desde HID Global

### El lector se congela o no responde

1. Desconectar y reconectar el cable USB
2. Si persiste, reiniciar la computadora
3. Verificar que no hay conflicto con software DigitalPersona legacy (desinstalar DigitalPersona Personal si existe)

## 6. Notas Tecnicas

### Como funciona internamente

- El POS usa la API WebAuthn del navegador (Web Authentication API)
- `authenticatorAttachment` NO esta restringido a `platform` — esto permite tanto autenticadores de plataforma (Windows Hello) como cross-platform (llaves FIDO2)
- Se soportan algoritmos ES256 y RS256 (Windows Hello usa RSA)
- Las credenciales se guardan en `localStorage` bajo la llave `pos_biometric_credentials`
- Cada credencial esta ligada al staff ID del empleado

### Seguridad

- Las huellas nunca salen del lector/Windows — solo se almacena un ID de credencial
- WebAuthn usa criptografia de llave publica — el servidor nunca ve la huella
- El PIN siempre queda como fallback
- Si se roba la terminal, las credenciales sin la huella fisica son inutiles

### Limitaciones

- Solo funciona en terminales donde esta configurado Windows Hello con el lector
- Si se borra localStorage, hay que re-registrar (no se pierden las huellas de Windows Hello, solo el enlace POS)
- Un empleado debe registrar su huella en cada terminal que use
