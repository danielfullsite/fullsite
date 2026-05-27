# Fullsite POS — React Native

App nativa para el POS de restaurantes. Scaffolding listo, pendiente implementar:

## Setup

```bash
cd mobile-app
npm install
npx expo start
```

## Estructura

```
src/
  lib/
    supabase.ts       — Cliente Supabase
    types.ts           — Tipos compartidos con dashboard-app
    store.ts           — Estado global (Zustand)
    offline-db.ts      — SQLite para offline-first
    printer-native.ts  — Bluetooth ESC/POS nativo
  screens/
    LoginScreen.tsx    — PIN login
    POSScreen.tsx      — Terminal principal
```

## Ventajas sobre web

- **Bluetooth nativo**: BLE directo sin limitaciones de WebBluetooth
- **SQLite offline**: Base de datos real en vez de IndexedDB
- **Push notifications**: Alertas nativas para cocina/barra
- **Performance**: Animaciones a 60fps, listas virtualizadas nativas
- **Multi-printer nativo**: MTU de 512+ bytes vs 128 de WebBluetooth

## Pendiente implementar

1. Navegacion completa (KDS, mesas, historial, inventario, corte)
2. BLE printer connection (expo-bluetooth-serial o react-native-ble-plx)
3. Background sync con SQLite
4. Push notifications (expo-notifications)
5. Barcode scanner nativo
6. MercadoPago Point Smart SDK nativo
