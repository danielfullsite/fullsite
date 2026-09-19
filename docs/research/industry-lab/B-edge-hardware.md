> ⚠️ **ADVERTENCIA DE FIABILIDAD (añadida 2026-09-18).** Este documento lo produjo un agente del
> intento de research en paralelo del 2026-09-17, que **terminó abortado por límite de uso**; varios
> de esos agentes agotaron el presupuesto de búsqueda y degradaron sus fuentes a mitad del trabajo.
> Además, **toda referencia a código de este repo se leyó del working tree `feat/pos-ui-kit`, que
> está 663 commits atrás de `origin/main`** — el mismo error que invalidó un hallazgo del Track A
> (ver `P0B-COMMAND-RECEIPTS.md`). **No fue revisado.** Úsalo como pista, no como fuente. Antes de
> citar cualquier cosa de aquí: verifica la URL, y verifica el código con `git show origin/main:<ruta>`.

# Track B — Edge local del restaurante + hardware + matriz de certificación

> Sprint de investigación (solo lectura). Fecha: 2026-09-17. Sin código, sin commits, sin acceso a producción.
> Etiquetas: **FACT** (fuente primaria citada) · **INFERENCE** (deducción nuestra) · **RECOMMENDATION** (decisión propuesta).
> Precios: sólo los que aparecieron publicados en la fecha de búsqueda; donde no encontré precio, lo digo. No inventé specs.

## 0. Contexto interno que arranca este track

- Instalación actual por restaurante (brief del sprint): una PC Windows de caja con Electron + Pedro (servidor Node local, puerto 7717, sirve el KDS por `http://127.0.0.1:7717/kds` para evitar mixed-content), POS secundarios en Electron, KDS en Electron modo `kds_only`, impresoras térmicas USB vía print bridge local, lector de huella para login, Supabase en nube. IP LAN estática de la caja escrita a mano en un JSON de config (incidente de BOM/encoding en una instalación).
- **Contradicción interna a resolver:** `docs/customers/amalay/DEPLOYMENT-STATE.md:27-36` describe la topología de AMALAY como "Tablet + Chrome" en POS y KDS, impresora `EC-PM-80250` (térmica 80 mm, marca genérica) y terminal bancaria Mercado Pago Point; el brief describe Electron en todo. INFERENCE: el doc está desactualizado respecto al instalador Electron. Hay que fechar y corregir ese doc antes de usarlo como base de la matriz.
- Lo que este track NO repite: `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`, `docs/architecture/PER-02-RESEARCH.md`.

---

## 1. Qué hardware envía o certifica la industria (FACT, con URL)

### 1.1 Toast — hardware propio Android, Ethernet obligatorio en lo fijo
- Toast vende sólo hardware Android (Toast Flex 14", Toast Go handheld, Elo como terminal alterna en 10/15/22"); no hay app iOS. Fuente: https://pos.toasttab.com/hardware/toast-flex y https://tech.co/pos-system/toast-pos-review
- Toast Flex: pantalla 14", opera hasta 120 °F, cables dentro de la base, modular para POS/KDS/kiosko. OS Android 7.1/9/12 "y futuras", Wi-Fi 2.4/5 GHz, BT 4.0 BLE, HDMI/USB. Fuente: https://pos.toasttab.com/hardware/toast-flex y https://support.toasttab.com/en/article/What-Kind-of-Hardware-Do-I-Have
- **Conexión por dispositivo** (tabla oficial): Toast Flex, Elo V2, Elo Kiosk, Flex for Guest, **Toast Printer** y el lector contactless **requieren Ethernet**; sólo los handhelds Toast Go 2/3 van por Wi-Fi (Go 3 con celular como respaldo, Wi-Fi priorizado). Fuente: https://support.toasttab.com/en/article/Supported-Network-Connections-by-Toast-Device
- KDS: dos opciones, Toast Flex for Kitchen (14") o pantalla Elo (cualquier tamaño Elo), ambas Android. Fuente: https://support.toasttab.com/en/article/Get-Started-With-the-Kitchen-Display-System
- Impresoras certificadas por Toast en su plataforma Android: Epson **TM-T88V** y **TM-T20II** Ethernet (recibos) y **TM-U220B** Ethernet (cocina, impacto). Fuente: https://news.epson.com/news/toast-certifies-3-epson-tablet-pos-friendly-printers-for-its-android-pos-platform
- Spec guide oficial en PDF (no pude extraer texto, el PDF es binario para el fetcher; hay que abrirlo a mano): https://d2c9w5yn32a2ju.cloudfront.net/knowledgebase/Toast-Hardware_Specs_DIGITAL.pdf

### 1.2 Square — hardware propio + lista corta de terceros (Star)
- Página de compatibilidad de impresoras lista Star **TSP143IV UE** y **mC-Print3 (MCP30)**, interfaces USB y Ethernet; categorías separadas para impresoras de cocina térmicas e impacto. Fuente: https://squareup.com/us/en/compatibility/accessories/printers
- Cajón "printer-driven": "Some cash drawers connect directly to a compatible receipt printer in order to open automatically." Fuente: https://squareup.com/us/en/compatibility/accessories/cash-drawers
- Square Register prefiere Ethernet sobre Wi-Fi si ambos existen; no soporta captive portal; diagnóstico por IP `0.0.0.0` / `169.254.x.x`. Fuente: https://squareup.com/help/us/en/article/8343-troubleshoot-network-connection-on-square-register
- Offline: pagos offline se suben al reconectar; pueden rechazarse si no se procesan en 24 h; subir antes de 72 h. Fuente: https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode

### 1.3 Lightspeed Restaurant (K-Series) — iPad + impresoras LAN
- Recomienda impresoras **LAN** "to support a sturdy and reliable connection"; modelos citados: Star TSP100 LAN, Star SP742 (cocina, impacto), Epson TM-m30 LAN. Fuentes: https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260800124209-Supported-hardware y https://www.lightspeedhq.com/uk/pos/restaurant/hardware/

### 1.4 TouchBistro — iPad; con 6+ iPads exige Mac local
- "iPad solutions with 6 or more iPads require either a Mac Mini or an iMac" (i3 quad 3.6 GHz, 8 GB, SSD 128 GB mínimo). Impresoras: Star TSP143III (USB/BT/LAN), TSP650II; Epson **TM-T88VI** (T88V y anteriores NO). Fuente: https://cdn.touchbistro.com/hardware-requirements/ y https://cdn.touchbistro.com/help/articles/setting-up-an-epson-tm-t88vi-thermal-printer/
- INFERENCE: TouchBistro es el caso más parecido a Fullsite — un POS "cloud" que igual mete un servidor local (Mac) cuando el sitio crece. Confirma que el "edge local" no es una rareza de Fullsite.

### 1.5 Parrot (México) — Android, 100 % nube, 30 Mbps
- "Parrot opera completamente en la nube"; requiere internet "de al menos 30 megas por segundo"; recomienda cableado en todos los equipos; ninguna afirmación de offline; Parrot Pay como terminal bancaria propia. Fuente: https://parrotsoftware.com.mx/ y https://parrotsoftware.com.mx/soluciones/parrot-pay
- INFERENCE: la oferta de Fullsite ("más confiable que Wansoft cuando se cae el internet") ataca justo el punto que Parrot no cubre en su web.

### 1.6 Clover / Fiserv México — Android, dev kit sólo con contrato
- "To have a developer kit inside Mexico, it is necessary to have a contractual relationship, whether as an ISV or a direct client"; en LATAM sólo Clover Flex 3 y Clover Mini 3; dev kits sólo para sandbox; semi-integración vía **REST Pay**. Fuentes: https://docs.apis-fiserv.com/latam/docs/card-present-clover-devices y https://docs.apis-fiserv.com/latam/docs/card-present-clover-isv-brazil-mexico

### 1.7 Elo — Windows 11 IoT Enterprise LTSC preinstalado; línea Android paralela
- Elo AIO Windows salen con **Windows 11 IoT Enterprise LTSC** preinstalado (10 años de soporte). Fuente: https://elosupport.elotouch.com/hc/en-us/articles/32689493971351-Which-Windows-11-IoT-Enterprise-LTSC-image-is-preinstalled-on-Elo-All-In-One-touchcomputers
- I-Series for Windows 15"/22", Intel 8ª gen, hasta 8 GB RAM / 128 GB SSD, PCAP 10 toques. Fuente: https://www.elotouch.com/i-series.html
- Precio listado (EE. UU.): I-Series 2.0 22" i3/8 GB/128 GB **USD 1,808.27** (CDW) https://www.cdw.com/product/elo-i-series-2.0-esy22i3-all-in-one-core-i3-8100t-3.1-ghz-8-gb-ssd/5854470 ; I-Series 3 22" MSRP **USD 2,191** https://www.logiscenter.us/elo-e701155-pos-point-of-sale . No encontré precio MX publicado.
- Android: I-Series 5 (10/15/22", Android 14 GMS) y Backpack 4/5 (motor Android para pegar a pantallas Elo 7–65"). Fuentes: https://www.prnewswire.com/news-releases/elo-unveils-the-i-series-5-for-android-and-backpack-5-for-android-302445656.html y https://www.elotouch.com/accessories-backpack-5-android-computer.html

### 1.8 Sunmi — Android, impresora integrada
- D3 Mini: 10.1" 1280×800, Qualcomm hexa-core 2.4 GHz, 3 GB/32 GB, display cliente 2.4", Android. Fuente: https://www.sunmi.com/en/d3-mini/ y https://docs.sunmi.com/en-US/ceghjk502/iddeghjk524
- T3 Pro Max: 15.6" FHD, Qualcomm octa-core 2.7 GHz, 6+128 GB, Wi-Fi 6E, impresora 80 mm integrada 250 mm/s. Fuente: https://www.jarltech.com/en/sunmi-t3-pro-max
- FACT: Sunmi es Android; no encontré línea Windows.

### 1.9 Mini PC x86 / industrial
- ASUS NUC 14 Essential (Intel N-series, 2.5G LAN, Wi-Fi 6E): **USD 311 barebone** (sin RAM/SSD) según reseña; kit N97 ~USD 207 en eBay. Fuente: https://root-nation.com/en/pc-en/pc-monoblocks-en/en-asus-nuc-14-essential-review/ y https://www.asus.com/us/displays-desktops/nucs/nuc-mini-pcs/asus-nuc-14-essential/techspec/
- OnLogic: mini PCs industriales fanless (Core Ultra / Ryzen), pensados para "kiosks, POS systems, and signage". Fuente: https://www.onlogic.com/store/computers/nuc/
- Advantech UNO-2372V3: fanless, Intel N250, DDR5, edge industrial. Fuente: https://www.advantech.com/en-us/resources/news/advantech-unveils-uno-2372v3-intelligent-and-integrated-edge-automation-computer-for-industrial-iot-applications
- No encontré precios públicos MX de OnLogic/Advantech.

### 1.10 Odoo IoT Box — el "edge box" de referencia en open source
- Raspberry Pi 3 B+ o superior (Pi 4 desde 2020, dos HDMI), SD ≥16 GB Clase 10 UHS-I U3; conecta por Ethernet o Wi-Fi (emite `IoTBox-xxxx`, config en `http://10.11.12.1`); impresoras por USB o red; "if there is a linux driver for your printer, chances are it will work"; alternativa **Windows virtual IoT**; sección dedicada a certificado HTTPS navegador→caja; "Never make the IoT box accessible from the public Internet". Fuentes: https://www.odoo.com/documentation/18.0/applications/general/iot/iot_box.html y https://www.odoo.com/forum/help-1/what-devices-work-with-the-iot-box-of-odoo-v12-0-140695
- INFERENCE: Odoo tuvo exactamente el problema de mixed-content de Fullsite (browser https → caja http) y lo resolvió con un cert por caja; y aun así ofrece la variante "virtual IoT" en Windows porque la Pi no es la respuesta universal.

---

## 2. Impresión

### 2.1 ESC/POS y cajón
- `ESC p m t1 t2`: pulso al pin 2 (m=0) o pin 5 (m=1) del conector drawer-kick; on/off = t×100 ms; no se pueden pulsar ambos a la vez. Fuente: https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_lp.html
- Conector RJ11/RJ12 "DK": pulso + sensor abierto/cerrado; se recomienda cable 6 pines. Fuente: https://www.posatmparts.com/guides/cash-drawer-wiring-connection-guide
- Simphony documenta la conexión del cajón vía impresora: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_cash_drawer_connect.htm
- FACT interno: en AMALAY el cajón está "conectado a impresora POS" y hay pendiente P1-03 "cajón abre en cualquier impresora" (`DEPLOYMENT-STATE.md:35,58`). INFERENCE: el cajón debe pertenecer a una única impresora "de caja" por terminal; abrirlo desde "cualquier impresora" es un antipatrón (la de cocina no tiene cajón).

### 2.2 Epson ePOS-Print / ePOS SDK
- ePOS-Print XML: imprime vía HTTP a `http://[host]/cgi-bin/epos/service.cgi?devid=[id]&timeout=[ms]` en impresoras "TM-i" y TM-m; SDK JS (`epos-print-x.x.x.js`) se sirve desde un web server y corre en el navegador. Fuente: https://files.support.epson.com/pdf/pos/bulk/epos-print_xml_um_en_revs.pdf y https://download4.epson.biz/sec_pubs/pos/reference_en/epos_js/index.html (esta última devolvió 403 al fetcher; verificar a mano). TM-m30 soportado por ePOS SDK v2.27.0g. Fuente: https://epson.com/Support/Point-of-Sale/Thermal-Printers/Epson-TM-m30-Series/s/SPT_C31CE95011
- Server Direct Print (la impresora hace polling a un servidor) descrito en https://download4.epson.biz/sec_pubs/pos/reference_en/technology/epson_epos_sdk.html
- Precio MX: TM-m30III estándar **MXN 10,573.73** en Amazon MX (fecha de búsqueda). Fuente: https://www.amazon.com.mx/Epson-TM-M30III-112-Modelo-EST%C3%81NDAR/dp/B0BXH4B5DT ; ficha oficial MX: https://epson.com.mx/Para-el-trabajo/Impresoras/Punto-de-Venta/Impresora-T%C3%A9rmica-de-Recibos-TM-m30III/p/C31CK50012

### 2.3 Star Micronics
- CloudPRNT: la impresora hace **HTTP POST a un único URL** a intervalo fijo y el servidor responde con trabajos; CloudPRNT Next usa **MQTT**. Soportado en mC-Print2/3, TSP143IV/IV SK, TSP743IIW, TSP847II, SP742, mC-Label2/3. Fuente: https://starmicronics.com/cloudprnt-web-cloud-online-pos-receipt-printing-sdk-developers/
- WebPRNT (impresión desde navegador por HTTP a la impresora) y manual mC-Print3: https://www.star-m.jp/products/s_print/mcprint3/manual/en/settings/settingsWebPRNT.htm , https://www.starmicronics.com/Resources/CMSFiles/WebPRNT%2005-01-2020.pdf
- StarPRNT SDK (Windows C#, Android, iOS) con `searchPrinter`; StarIO10 descubre dispositivos LAN en 10–300 ms. Fuente: https://starmicronics.com/starprnt-sdk-pos-printing-java-swift/ y https://www.star-m.jp/products/s_print/sdk/starprnt_sdk/manual/android_java/en/api_stario_port.html
- TSP143IV en México: distribuidores Cyberpuerta, Abasteo, Amazon MX (TSP143IVUE USB/Ethernet + CloudPRNT). No obtuve precio numérico en la búsqueda; ver https://www.cyberpuerta.mx/Punto-de-Venta-POS/Impresoras-de-Tickets/Star-Micronics-TSP143IV-Impresora-de-Tickets-Termica-Directa-Alambrico-203-x-203DPI-USB-Gris.html y https://www.amazon.com.mx/Star-Micronics-TSP143IVUE-Impresora-alimentaci%C3%B3n/dp/B0BKR6LLLK

### 2.4 USB vs Ethernet vs Bluetooth — lo que dice la industria
- FACT: Toast exige Ethernet en su impresora; Lightspeed recomienda LAN; TouchBistro acepta BT/Lightning sin router pero Ethernet para compartir. Toast: impresoras salen de fábrica en **DHCP**. Fuente: https://support.toasttab.com/en/article/Toast-Network-Requirements-Overview
- Windows USB: el puerto virtual `USB001/USB002…` puede cambiar al reconectar; el driver queda apuntando al puerto viejo y "no imprime". Fuente: https://www.epson.eu/en_EU/faq/KA-01496/contents y https://learn.microsoft.com/en-us/answers/questions/4245329/usb001-printer-port-missing-in-windows-10 ; guía práctica: https://mike42.me/blog/2015-04-getting-a-usb-receipt-printer-working-on-windows
- INFERENCE: la ventaja de Ethernet no es velocidad, es que la impresora es **direccionable por cualquier nodo** (caja, POS secundario, Pedro) y sobrevive a que se reinicie la PC; USB ata la impresora a una PC y a su enumeración.

### 2.5 Librerías Node (STARS / LICENSE / LAST_ACTIVE / RISKS)
| Lib | Stars | Licencia | Última actividad | Transportes | Riesgo |
|---|---|---|---|---|---|
| `node-thermal-printer` (Klemen1337) | 915 | MIT | v4.6.1 publicada hace ~1 mes (ago-2026) | TCP `tcp://ip:9100`, driver del sistema (`printer`/`electron-printer`), COM/archivo | Bajo: activo; Epson/Star/Tanca/Daruma/Brother. https://github.com/Klemen1337/node-thermal-printer , https://www.npmjs.com/package/node-thermal-printer |
| `node-escpos` (lsongdev) / `@node-escpos/core` | 1.6k | MIT | `@node-escpos/core` 0.6.0 publicado hace ~2 años; 108 issues abiertos | USB (libusb), red, serial, BT | Medio-alto: USB en Windows depende de libusb/WinUSB (reemplazo de driver); mantenimiento lento. https://github.com/lsongdev/node-escpos , https://www.npmjs.com/package/@node-escpos/core |
| `escpos-buffer` (grandchef) | 58 | (ver repo) | v4.1.0 hace ~3 años | sólo genera buffer | Alto por abandono. https://github.com/grandchef/escpos-buffer |
| `react-thermal-printer` (seokju-na) | 3,287 | (ver repo) | v0.22.0 hace ~1 año | renderer React → `Uint8Array`; tú pones el transporte | Medio: sin transporte, sin releases recientes. https://github.com/seokju-na/react-thermal-printer |
| `python-escpos` (referencia de comandos) | — | — | — | — | Útil como documentación cruzada del `ESC p`. https://python-escpos.readthedocs.io/en/v2.0.0/api/escpos.html |

RECOMMENDATION: generar bytes ESC/POS con una lib delgada y mantenida (`node-thermal-printer`) y **transportar por TCP 9100 o por driver del sistema**, nunca por libusb en Windows. Cola de impresión persistente en Pedro (SQLite/IndexedDB) con reintento y failover a impresora alterna, que es lo que hoy hace a mano el runbook de AMALAY ("usar la impresora de cocina como respaldo temporal", `DEPLOYMENT-STATE.md:121`).

### 2.6 Descubrimiento vs IP estática vs reserva DHCP
- FACT: Toast usa DHCP + subred fija `192.168.192.0/24` + Bonjour habilitado en el router. Fuente: https://support.toasttab.com/en/article/Toast-Network-Requirements-Overview
- FACT: Star ofrece búsqueda LAN en SDK; Epson ofrece EpsonNet Config para descubrir/configurar. Fuente: https://files.support.epson.com/pdf/pos/bulk/npd6760-00_en_network_guide.pdf
- RECOMMENDATION: **reserva DHCP por MAC en el router + descubrimiento mDNS como verificación**, no IP estática escrita en JSON. La IP estática a mano ya produjo el incidente de BOM; una reserva DHCP vive en el router (un solo lugar), y Pedro se anuncia por mDNS (`_fullsite._tcp`) para que POS/KDS lo encuentren aunque cambie. Si el router no permite reservas (routers de ISP), Fullsite pone su propio router (ver §3).

---

## 3. Red

- Toast (FACT): red físicamente segmentada o **VLAN dedicada** `192.168.192.0/24`, puertos etiquetados "FOR TOAST USE ONLY"; Wi-Fi sólo en 5 GHz, señal nunca por debajo de **-65 dBm**, WPA2/AES, SSID en la misma VLAN; QoS; cableado Cat5e+ (568B); ancho de banda 3/1 Mbps (2 tablets, 1 KDS) hasta 15/5 Mbps (30 tablets, 4 KDS). Fuente: https://support.toasttab.com/en/article/Toast-Network-Requirements-Overview y https://support.toasttab.com/en/article/Site-Readiness-Guide
- Square (FACT): Ethernet preferido si existe; sin captive portal. Fuente: https://squareup.com/help/us/en/article/8343-troubleshoot-network-connection-on-square-register
- Parrot (FACT): 30 Mbps y cableado en todo. Fuente: https://parrotsoftware.com.mx/
- Failover LTE (fuentes secundarias, integradores): router dual-WAN con failover 4G/5G ≈ USD 300–550 + USD 30–50/mes; conmutación 5–15 s (business) o 30–60 s; tráfico POS 5–20 MB/terminal/hora. Fuente: https://vivantcorp.com/restaurant-internet-redundancy-planning-a-practical-guide-for-operators/ y https://www.skytabpartners.us/blog/pos-network-requirements/
- **Contradicción:** Toast no publica requisitos de UPS ni failover celular en su doc de red (verificado en el fetch); los integradores sí los venden. INFERENCE: para Fullsite, cuyo diferenciador es offline, el failover LTE es *deseable* (mantiene tarjeta y delivery) pero **no** condición de operación; la UPS sí, porque protege al nodo local (Pedro) y al switch, que es lo que mantiene KDS e impresoras vivos sin WAN.

RECOMMENDATION (diseño LAN mínimo Fullsite):
1. Router/AP propio de Fullsite (o VLAN dedicada si el sitio tiene TI), subred fija documentada, DHCP con reservas, mDNS permitido.
2. **Cableado**: caja/Pedro, impresoras y KDS por Ethernet; Wi-Fi 5 GHz sólo para handhelds.
3. Switch PoE pequeño + UPS para router, switch y caja.
4. LTE opcional como segundo WAN (no bloquea la instalación).

---

## 4. ¿El servidor es la caja o una caja dedicada? Lo que hacen los sistemas "de autoridad local"

### 4.1 Oracle MICROS Simphony — CAPS
- FACT: "The Check and Posting Service (CAPS) is a required service that runs on-premises at the property. CAPS acts as the bridge between the Enterprise and the property, providing resiliency and increasing system performance." Guarda transacciones, las postea al Enterprise en tiempo real y es "the arbitrator of check sharing by maintaining a record of check ownership". Corre en IIS o servicio Windows con Oracle DB o SQL Server; en sitios con muchas transacciones "may be necessary to run CAPS on a PC with significantly more computing resources". Fuente: https://docs.oracle.com/cd/E76065_01/doc.29/e69879/c_caps.htm
- FACT: sin WAN, "POS clients are largely unaffected as they continue to post transactions to the on-premises CAPS. When the WAN connection is restored, CAPS posts the information to the Enterprise." Misma fuente.
- FACT: modos de la workstation — **Yellow** (LAN sí, nube no: transacciones al offline cache, CAPS online) y **Red** (aislada del todo: transacciones al DataStore local, replay automático). Fuente: https://docs.oracle.com/cd/F10429_01/doc.182/f10214/c_workstation_online_offline_modes.htm
- Simphony Essentials también trae CAPS: https://docs.oracle.com/en/industries/food-beverage/simphony-essentials/sslcg/c_admin_caps.htm

### 4.2 NCR Aloha — File Server + Master Terminal (redundancy)
- FACT: existe un BOH "file server" (servicios CtlSvr, AeMInStoreService, SQL Server Express, dongle USB); un terminal es **Master** (texto "Master" en la pantalla de login); si el file server cae, los terminales entran en **redundancy** y muestran **borde rojo**. Fuente: https://wagos.com/kb/ncr-aloha-troubleshooting-checklist/
- Fuentes secundarias (foros/blogs de técnicos Aloha, no NCR): el Master (normalmente TERM1) asume el rol de file server, botón "Make Fileserver", opera hasta ~30 días así, y luego se hace "file server recovery" desde Aloha Manager. Fuente: https://www.tek-tips.com/threads/aloha-redundancy-mode.1738705/ y https://jva.ntu.mybluehost.me/kb/aloha-file-server-recovery/ . **No encontré el documento oficial NCR** de "Terminal Redundancy"; el doc oficial que sí existe es de Aloha Takeout: https://delightful-coast-06c41e60f.3.azurestaticapps.net/restaurant/aloha-takeout/implementing/enabling_redundancy — marcar como INFERENCE hasta abrirlo.

### 4.3 PAR Brink — "sin servidor local", con offline por terminal
- FACT (marketing PAR/resellers): "entirely cloud-based… don't have to have a back-end server", offline mode por terminal con sync al reconectar, "redundant servers". Fuente: https://www.rdspos.com/Brink-POS y https://www.posusa.com/brink-pos-review/
- **Contradicción:** Brink dice "no server" y a la vez "offline mode"; Simphony y Aloha dicen que sin autoridad local no hay check-sharing consistente. INFERENCE: Brink resuelve el offline por terminal (cada terminal con su cola), lo que funciona en QSR con tickets cortos y sin mesas compartidas; en servicio a mesa con varios meseros sobre la misma cuenta, el arbitraje de "quién es dueño del check" (lo que CAPS hace explícitamente) necesita un nodo local. Fullsite es servicio a mesa → necesita Pedro.

### 4.4 Toast — todo en nube, hardware fijo cableado
- FACT: no publica un componente de servidor local; la resiliencia va por Ethernet obligatorio + handhelds con Wi-Fi/celular. Fuentes ya citadas. INFERENCE: Toast "compra" la disponibilidad con su propio hardware y red; su offline es por dispositivo.

### 4.5 Decisión: ¿caja PC o box dedicado?
- FACT industria: Simphony/Aloha corren la autoridad local en un **PC de back-office** distinto de la caja (con excepción de redundancia en Aloha, donde un terminal asume); TouchBistro mete un Mac cuando hay ≥6 iPads; Odoo usa una Pi; Brink/Toast ninguno.
- RECOMMENDATION: **dos perfiles, un mismo software**:
  - **Perfil A (1–3 terminales, la mayoría de los 1,000):** Pedro corre en la caja (como hoy). Es el "master terminal" de Aloha. Riesgo aceptado: reiniciar la caja tira KDS/impresión unos segundos.
  - **Perfil B (≥4 terminales o más de una cocina):** Pedro en mini PC fanless dedicado, headless, con UPS, en el rack del router. Es el CAPS. Mismo instalador, rol `server`.
  - No hacer "elección de master" dinámica (Aloha) en v1: es lo más complejo de todo el diseño y sólo paga cuando hay muchos terminales.

---

## 5. Windows vs Linux vs Android para el edge; kiosco; energía; disco

- FACT: Windows 11 IoT Enterprise LTSC 2024 — 10 años de soporte, sólo por distribuidores OEM/IoT (Arrow, Avnet, Advantech), "desde USD 295" CSP, precio por clase de CPU; requisitos 1 GHz / 4 GB / 64 GB; "intended for special purpose, fixed function devices". Fuentes: https://learn.microsoft.com/en-us/windows/iot/iot-enterprise/whats-new/windows-11-iot-enterprise-ltsc-2024 , https://o365hq.com/software/windows-11-iot-enterprise-ltsc-2024 , https://www.cdw.com/product/windows-11-iot-enterprise-ltsc-2024-license-1-license/8025005 . Restricción: no sustituye Windows de propósito general. Fuente: https://learn.microsoft.com/en-my/answers/questions/5922757/license-restrictions-on-using-windows-10-iot-enter
- FACT kiosco: Assigned Access (single-app) sólo soporta apps UWP o Edge; para **Win32 (Electron) hay que usar Shell Launcher**, disponible en Enterprise / IoT Enterprise (no en Pro). Fuente: https://learn.microsoft.com/en-us/windows/configuration/assigned-access/configure-single-app-kiosk y https://learn.microsoft.com/en-us/windows/configuration/assigned-access/
- FACT Electron: electron-updater NSIS — modo "onNextLaunch" evita que Windows mate el instalador NSIS al cerrar sesión/apagar; instalación automática al arrancar sólo con NSIS per-user sin elevación; no probar auto-update en dev. Fuente: https://www.electron.build/docs/features/auto-update/ y https://www.electronjs.org/docs/latest/api/auto-updater . Ejemplo kiosco Electron con Shell Launcher + AutoLogon + MSI/Intune: https://github.com/syedhassaanahmed/kiosk-demo-electron
- FACT energía/disco: la política de write-caching de Windows ("Better performance" en internos) puede perder datos ante corte de luz; "turning off Windows write-cache buffer flushing… can cause data loss in the event of power failure". Fuente: https://www.windowscentral.com/how-manage-disk-write-caching-external-storage-windows-10 . eMMC carece de ECC/DRAM avanzados y over-provisioning de SSD; corte durante escritura puede corromper metadatos. Fuente: https://nexusindustrialmemory.com/emmc-vs-ssd/ y https://arxiv.org/pdf/1805.00140
- RECOMMENDATION:
  - **Windows 11 IoT Enterprise LTSC** en hardware certificado que ya lo trae (Elo) o Windows 11 Pro en BYO; **no** Linux en v1 (perderíamos el bridge de impresión por driver, el SDK de huella HID y el conocimiento de campo actual); Android sólo para POS secundarios/handhelds en fase posterior.
  - Electron en kiosco vía Shell Launcher cuando el OS lo permita; en Pro, auto-login + app al inicio + tecla de escape con PIN.
  - Auto-update con `onNextLaunch`, ventana de mantenimiento fuera de servicio, rollback al instalador anterior guardado en disco (§10 del protocolo interno).
  - **SSD siempre, eMMC "Unsupported" para el rol server**; dejar "buffer flushing" habilitado (default) y que Pedro haga `fsync` en el event store; UPS obligatoria en el rol server.

---

## 6. Huella

- FACT: HID DigitalPersona U.are.U 4500 — driver WBF (Windows Hello) 5.0.0.5 (2021); SDK "DigitalPersona Biometric SDK" para Android/Linux/Windows; para navegador existe `@digitalpersona/devices` + `WebSdk`, que **requiere el DigitalPersona Agent / Lite Client instalado en la máquina** y es "browser-only… cannot be run in NodeJS". Fuentes: https://www.hidglobal.com/drivers/39477 , https://hidglobal.github.io/digitalpersona-devices/ , https://hidglobal.github.io/digitalpersona-devices/how-to.html , https://sdk.hidglobal.com/developer-center/digitalpersona-touchchip . Issue real con React/Windows 10/4500: https://github.com/hidglobal/digitalpersona-devices/issues/27
- FACT: ZKTeco ZKFinger SDK Windows — SLK20R, ZK9500/6500/8500R; XP→Win10, 32/64. Fuente: https://www.zkteco.com/en/ZKFingerSDKforWindows/ZKFinger-SDK-for-Windows
- FACT: Suprema BioMini SDK Windows/Linux/Android; NIST MINEX, FIPS 201. Fuente: https://www.kimaldi.com/en/product/suprema-biomini-sdk-for-windows-and-linux/
- FACT interno: "huella indispensable" para AMALAY (memoria `project_amalay_respuestas_producto_20260905.md`) y regresión abierta (`project_amalay_huella_rota_en_candidato.md`).
- INFERENCE: la ruta más barata en Electron es capturar la **plantilla** vía SDK nativo (módulo N-API o proceso helper) en el main process y matchear localmente en Pedro; la ruta "WebSdk en renderer" mete un agente extra por máquina y ya mostró fragilidad (issue #27). RECOMMENDATION: certificar **un solo** lector (el que ya está en campo, si es U.are.U) y marcar los demás "Compatible" sólo cuando alguien los pruebe con el instalador.

---

## 7. Terminales bancarias en México como hardware

| Proveedor | Dispositivos | Vía de integración | Local/offline | Fuente |
|---|---|---|---|---|
| Mercado Pago Point | Point Smart (y Smart 2) | **Nube**: Orders API (nueva) crea orden → el Point la muestra; la API Point Integrations "legacy" se descontinúa; sólo tarjeta/contactless/"SWIFT" | No documentado; requiere que el Point tenga internet | https://www.mercadopago.com.mx/developers/es/news/2025/07/16/Transform-your-point-of-sale-with-the-new-integration-between-Point-and-the-Orders-API , https://www.mercadopago.com.mx/developers/es/docs/mp-point-legacy/integration-configuration/integrate-with-pdv/introduction.md , https://github.com/mercadopago/point-android_integration |
| Clip | Clip Plus, Clip Pro, Clip Total | **Nube**: REST crea "transacción pendiente"; el cajero la abre en la app Clip del terminal; webhooks; hay que pedir a soporte que activen "Transacciones pendientes" | No | https://developer.clip.mx/docs/api-de-punto-de-venta |
| Getnet (Santander) | GSMART (Android) | Tres vías: app propia en el terminal, web en el terminal, QR; y **semi-integrada por USB con DLL .NET `UsbIntegration` (.NET Standard 2.0)** | USB local (la única local de la tabla) | https://www.gsmart.com.mx/i/devinfo.jsp , https://www.gsmart.com.mx/i/devsandbox.jsp |
| Clover / Fiserv MX | Clover Flex 3, Mini 3 | REST Pay (semi-integrado); dev kit sólo con contrato ISV | — | https://docs.apis-fiserv.com/latam/docs/card-present-clover-devices |
| Parrot Pay | terminal propia | cerrada al POS Parrot | — | https://parrotsoftware.com.mx/soluciones/parrot-pay |
| BBVA / Banorte | — | **No encontré** documentación pública de integración semi-integrada; estado: NO LOCALIZADO EN BÚSQUEDA WEB (no confirmado ausente) | — | — |

- INFERENCE: en México el patrón dominante es **semi-integración por nube** (MP, Clip, Clover): el POS crea la intención en la nube y el terminal la recibe por su propio internet. Eso significa que **el cobro con tarjeta no es offline en ningún proveedor mainstream** salvo Getnet por USB. Fullsite no debe prometer "tarjeta sin internet"; debe prometer "la cuenta, la comanda y el corte siguen; la tarjeta vuelve cuando vuelva la WAN o por LTE".
- FACT interno: AMALAY ya opera con Mercado Pago Point (`DEPLOYMENT-STATE.md:36`) y hay memoria `project_terminal_integration.md` (MP Point Smart + Clip). Ver Track C.

---

## 8. Entregables

### (a) Decisión: Certified + BYO, con la línea trazada por rol
- FACT: Toast = sólo hardware propio/certificado. Square = propio + lista corta. Lightspeed/TouchBistro = iPad + lista de impresoras. Odoo = "si hay driver Linux probablemente sirve". Parrot = "Android".
- RECOMMENDATION: **ambos, pero asimétrico.**
  - Rol **server/caja** y **impresora de caja con cajón**: sólo **Certified** (es donde vive el dinero y la autoridad local; un BYO aquí es un ticket de soporte garantizado).
  - Rol **POS secundario** y **KDS**: Certified o **Compatible** (BYO con checklist automático que corre el instalador: CPU, RAM, SSD, Ethernet, versión de Windows, touch).
  - Impresoras de cocina y escáneres: **Compatible** por protocolo (ESC/POS por TCP 9100 / HID keyboard wedge), no por modelo.

### (b) Matriz de certificación Fullsite (candidatos concretos)
| Rol | Certified (Fullsite revende / instala) | Compatible (BYO con checklist) | Unsupported |
|---|---|---|---|
| Server/caja (Perfil A) | Elo I-Series for Windows 15"/22" (Win 11 IoT Ent LTSC preinstalado; ~USD 1,808–2,191 en EE. UU., sin precio MX) | PC Windows 11 Pro x86 con SSD, 8 GB, Ethernet, touch PCAP | eMMC; Wi-Fi como única red; Windows Home; tablets Android como server |
| Server dedicado (Perfil B) | ASUS NUC 14 Essential (N-series, 2.5G LAN; ~USD 311 barebone + RAM/SSD) o mini PC fanless OnLogic/Advantech UNO (sin precio público) | cualquier x86 fanless con SSD + UPS | Raspberry Pi como server principal (ver "qué no construir") |
| POS secundario | mismo AIO Windows que la caja | tablet Windows 11 Pro touch, o Android (Sunmi D3 Mini / T3 Pro Max) **sólo cuando exista cliente Android** | iPad (no hay cliente) |
| KDS | Elo pantalla táctil + PC Windows mini; o Elo I-Series 5 Android / Backpack 5 **si** se libera KDS en navegador Android | cualquier PC/tablet con navegador moderno por Ethernet apuntando a Pedro | pantallas por Wi-Fi 2.4 GHz |
| Impresora caja + cajón | Epson TM-m30III (MXN 10,573.73 Amazon MX) o Star TSP143IV UE (precio MX no obtenido), **Ethernet** | cualquier ESC/POS con Ethernet/TCP 9100 y DK RJ12; USB sólo en la caja (con la advertencia USB00x) | Bluetooth como único enlace; impresoras Wi-Fi 2.4 en cocina |
| Impresora cocina | Epson TM-U220B Ethernet (impacto, certificada por Toast) o Star SP742 (Lightspeed) | térmica ESC/POS Ethernet | — |
| Cajón | RJ12 6 pines, 12/24 V según impresora (Star/Epson) | — | cajones USB/serial directos |
| Escáner | HID keyboard wedge USB | — | escáneres que exigen driver |
| Huella | el lector ya en campo (U.are.U 4500 si es el caso) + SDK nativo | ZKTeco SLK20R / Suprema BioMini vía SDK, sólo tras prueba | lectores "Windows Hello only" sin SDK |
| Terminal bancaria | Mercado Pago Point Smart (Orders API), Clip Plus/Pro/Total | Getnet GSMART (USB .NET) | Parrot Pay; Clover sin contrato ISV |
| Red | router propio con VLAN/reservas DHCP + switch PoE + UPS | VLAN del cliente con reservas | router del ISP sin reservas DHCP |

Precios marcados son los publicados en la fecha; **no hay precio MX para Elo, Star, OnLogic, Advantech ni Windows IoT** en lo que encontré.

### (c) Specs mínimas recomendadas (con porqué)
- **Server/caja:** x86 64-bit ≥4 núcleos (N100/N150 sirve; el CAPS de Oracle sube recursos sólo en sitios grandes), **8 GB RAM** (Electron + Node + Chromium del KDS local), **SSD ≥128 GB NVMe/SATA** (no eMMC — corrupción en corte de luz), **Ethernet Gigabit** (2.5G no hace falta), **Windows 11 IoT Ent LTSC o Pro** (Shell Launcher sólo en Enterprise/IoT), touch PCAP 10 puntos 15" (estándar Elo/Toast), 2 USB-A libres (huella + scanner), UPS ≥600 VA.
- **POS secundario:** igual pero 4–8 GB y 64 GB SSD.
- **KDS:** cualquier PC/tablet con Chromium por Ethernet; 4 GB; pantalla ≥14" (Toast Flex for Kitchen es 14").
- **Impresoras:** ESC/POS, **Ethernet**, DK RJ12; tasa de corte/velocidad no importa para certificación.
- **Red:** ≥15/5 Mbps dedicados si hay >10 terminales (Toast), pero Fullsite opera con 0 Mbps por diseño; Wi-Fi 5 GHz ≥ -65 dBm para handhelds.

### (d) Diseño de instalación repetible
1. **Un instalador, cuatro roles** (`server`, `pos`, `kds`, `print`): el rol se elige en la primera pantalla y queda en el registro/appdata, no en un JSON editado a mano.
2. **Descubrimiento**: Pedro publica `_fullsite._tcp` por mDNS y además responde en `http://fullsite-server.local:7717/health`; POS/KDS buscan por mDNS, cachean la última IP conocida y sólo como último recurso piden IP manual (validando `^\d+\.\d+\.\d+\.\d+$` y escribiendo el archivo **UTF-8 sin BOM** con un test de lectura inmediata — el hook de la regla "persistencia verificada con Read").
3. **Red**: reserva DHCP para el server en el router Fullsite; la IP nunca se teclea en dos lugares.
4. **Impresión**: rol `print` vive dentro de Pedro; impresoras registradas por **IP + rol** (caja, cocina, barra) con cola persistente, reintento, y failover configurado (`caja→cocina`). USB sólo en la caja, y el instalador verifica el puerto `USB00x` en cada arranque.
5. **KDS**: navegador kiosco apuntando a `http://<server>:7717/kds`; si Odoo lo resolvió con cert HTTPS por caja, Fullsite puede igual (Track A/I), pero en LAN aislada el http plano es aceptable hoy.
6. **Checklist automático** al instalar (CPU/RAM/SSD/Ethernet/OS/touch/UPS presente) que clasifica la máquina en Certified/Compatible/Unsupported y lo reporta a la flota (Track I).
7. **Rollback**: instalador anterior guardado local + `onNextLaunch`.

### (e) Qué revender / white-label vs recomendar
- **Revender (margen + control):** router/AP + switch PoE + UPS (es lo que más incidentes evita y lo que menos sabe comprar un restaurante), impresora de caja Ethernet + cajón, lector de huella. Son commodities con precios públicos y sin dependencia de contrato.
- **Recomendar, no revender (v1):** AIO Windows (Elo) — precio alto, logística MX incierta; dejar que el cliente lo compre o use su PC actual bajo checklist. Terminales bancarias — nunca; son del adquirente.
- **No white-label:** nada en v1. Toast y Sunmi hacen marca propia porque venden decenas de miles de unidades; a 1,000 restaurantes el white-label sólo añade inventario y soporte.

### (g) Top 5 URLs para leer completas
1. Oracle CAPS: https://docs.oracle.com/cd/E76065_01/doc.29/e69879/c_caps.htm (y modos Yellow/Red: https://docs.oracle.com/cd/F10429_01/doc.182/f10214/c_workstation_online_offline_modes.htm)
2. Toast Network Requirements: https://support.toasttab.com/en/article/Toast-Network-Requirements-Overview
3. Odoo IoT Box (incl. HTTPS cert y Windows virtual IoT): https://www.odoo.com/documentation/18.0/applications/general/iot/iot_box.html
4. Epson ePOS-Print XML manual: https://files.support.epson.com/pdf/pos/bulk/epos-print_xml_um_en_revs.pdf
5. Microsoft Assigned Access / Shell Launcher: https://learn.microsoft.com/en-us/windows/configuration/assigned-access/

### (h) Qué NO construir
- **Elección dinámica de master (Aloha "Make Fileserver") en v1.** Dos perfiles fijos bastan para 1,000 sitios pequeños; la elección automática es lo que más bugs de split-brain produce (Track A).
- **Driver USB propio (libusb/WinUSB) para impresoras.** Usar TCP 9100 o driver del sistema.
- **Un "IoT Box" en Raspberry Pi como servidor.** Odoo lo hace y aun así ofrece "Windows virtual IoT"; SD corruptible, sin SSD, y perderíamos huella/print bridge Windows. La Pi sólo tiene sentido como *print server* remoto en una cocina sin PC, y ni eso hasta tener demanda.
- **Cliente iOS.** Ningún competidor Android-first lo tiene (Toast no), y el hardware que el restaurante mexicano "ya tiene" es Windows/Android.
- **Cobro con tarjeta offline.** Ningún adquirente mexicano lo documenta; prometerlo es incumplible.
- **White-label de hardware.**
- **Protocolo de impresión propio.** ESC/POS + (opcional) CloudPRNT/ePOS para impresoras "inteligentes" ya cubren todo.

---

## 9. Contradicciones y huecos registrados
- Toast "sin servidor local" vs Simphony/Aloha "autoridad local obligatoria": no es contradicción de fuentes sino de segmento (QSR/handheld vs full-service). Fullsite está en el segundo.
- Brink "entirely cloud-based" y "offline mode" simultáneos: marketing; no hay doc técnico público de cómo comparten cuentas offline.
- `DEPLOYMENT-STATE.md` (tablets + Chrome) vs brief (Electron): documento interno desfasado.
- Toast no menciona UPS/LTE; integradores sí: fuentes secundarias, tratarlas como práctica común, no como requisito Toast.
- Docs oficiales no accesibles al fetcher (403/PDF binario): Epson ePOS JS index, Toast Hardware Specs PDF, Odoo `connect.html` (404 — la página vigente es `iot_box.html`). Se citan para lectura manual.
- No localizado (búsqueda web, no ausencia confirmada): precios MX de Elo/Star/OnLogic/Windows IoT; docs públicos de integración BBVA/Banorte; doc oficial NCR "Terminal Redundancy".
