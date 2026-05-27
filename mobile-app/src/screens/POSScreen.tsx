// Main POS screen — core terminal for taking orders
import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native'
import { usePOSStore } from '@/lib/store'
import { supabase } from '@/lib/supabase'
import type { MenuItem, OrderItem, MenuCategory } from '@/lib/types'

export default function POSScreen() {
  const { staff, menu, setMenu, isOnline, pendingSyncCount } = usePOSStore()
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [selectedMesa, setSelectedMesa] = useState('1')

  useEffect(() => {
    loadMenu()
  }, [])

  const loadMenu = async () => {
    try {
      const { data } = await supabase
        .from('pos_menu')
        .select('*')
        .eq('client_id', 'amalay')
      if (data) {
        // Transform to MenuCategory format
        // TODO: proper menu loading
        setMenu(data as unknown as MenuCategory[])
      }
    } catch {
      // Use cached menu
    }
  }

  const addItem = (item: MenuItem) => {
    setOrderItems((prev) => {
      const existing = prev.find((i) => i.menuItemId === item.id)
      if (existing) {
        return prev.map((i) =>
          i.menuItemId === item.id
            ? { ...i, cantidad: i.cantidad + 1, subtotal: (i.cantidad + 1) * i.precio }
            : i
        )
      }
      return [
        ...prev,
        {
          menuItemId: item.id,
          nombre: item.nombre,
          precio: item.precio,
          cantidad: 1,
          subtotal: item.precio,
        },
      ]
    })
  }

  const removeItem = (menuItemId: string) => {
    setOrderItems((prev) => prev.filter((i) => i.menuItemId !== menuItemId))
  }

  const total = orderItems.reduce((sum, i) => sum + i.subtotal, 0)
  const iva = total * 0.16
  const subtotal = total - iva

  const categories = menu.map((c) => ({ id: c.id, label: c.label }))
  const currentItems = selectedCategory
    ? menu.find((c) => c.id === selectedCategory)?.items ?? []
    : menu.flatMap((c) => c.items).slice(0, 20)

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.logo}>fullsite</Text>
          <Text style={styles.headerSub}>{staff?.name} | Mesa {selectedMesa}</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? '#10b981' : '#ef4444' }]} />
          <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
          {pendingSyncCount > 0 && (
            <Text style={styles.syncBadge}>{pendingSyncCount}</Text>
          )}
        </View>
      </View>

      <View style={styles.body}>
        {/* Menu side */}
        <View style={styles.menuSide}>
          {/* Category tabs */}
          <FlatList
            horizontal
            data={categories}
            keyExtractor={(c) => c.id}
            showsHorizontalScrollIndicator={false}
            style={styles.categoryBar}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.categoryTab, selectedCategory === item.id && styles.categoryTabActive]}
                onPress={() => setSelectedCategory(selectedCategory === item.id ? null : item.id)}
              >
                <Text style={[styles.categoryText, selectedCategory === item.id && styles.categoryTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            )}
          />

          {/* Menu items grid */}
          <FlatList
            data={currentItems}
            keyExtractor={(i) => i.id}
            numColumns={3}
            contentContainerStyle={styles.menuGrid}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.menuItem, !item.disponible && styles.menuItemDisabled]}
                onPress={() => item.disponible && addItem(item)}
                disabled={!item.disponible}
              >
                <Text style={styles.menuItemName} numberOfLines={2}>{item.nombre}</Text>
                <Text style={styles.menuItemPrice}>${item.precio.toFixed(2)}</Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {/* Order side */}
        <View style={styles.orderSide}>
          <Text style={styles.orderTitle}>Orden</Text>

          <FlatList
            data={orderItems}
            keyExtractor={(i) => i.menuItemId}
            style={styles.orderList}
            renderItem={({ item }) => (
              <View style={styles.orderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderItemName}>{item.cantidad}x {item.nombre}</Text>
                </View>
                <Text style={styles.orderItemPrice}>${item.subtotal.toFixed(2)}</Text>
                <TouchableOpacity onPress={() => removeItem(item.menuItemId)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>X</Text>
                </TouchableOpacity>
              </View>
            )}
          />

          {/* Totals */}
          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>${subtotal.toFixed(2)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>IVA (16%)</Text>
              <Text style={styles.totalValue}>${iva.toFixed(2)}</Text>
            </View>
            <View style={[styles.totalRow, styles.totalRowBig]}>
              <Text style={styles.totalBig}>TOTAL</Text>
              <Text style={styles.totalBig}>${total.toFixed(2)}</Text>
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnSecondary}>
              <Text style={styles.btnSecondaryText}>Pre-cuenta</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary}>
              <Text style={styles.btnPrimaryText}>Cobrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  logo: { color: '#fff', fontSize: 20, fontWeight: '900' },
  headerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  syncBadge: {
    backgroundColor: '#f59e0b', color: '#000', fontSize: 10, fontWeight: '700',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: 'hidden',
  },
  body: { flex: 1, flexDirection: 'row' },
  menuSide: { flex: 2, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.08)' },
  categoryBar: { maxHeight: 44, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  categoryTab: { paddingHorizontal: 16, paddingVertical: 10 },
  categoryTabActive: { borderBottomWidth: 2, borderBottomColor: '#10b981' },
  categoryText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  categoryTextActive: { color: '#10b981' },
  menuGrid: { padding: 8 },
  menuItem: {
    flex: 1, margin: 4, padding: 12, backgroundColor: '#111118', borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', minHeight: 72,
  },
  menuItemDisabled: { opacity: 0.3 },
  menuItemName: { color: '#fff', fontSize: 13, fontWeight: '500', marginBottom: 4 },
  menuItemPrice: { color: '#10b981', fontSize: 14, fontWeight: '700' },
  orderSide: { flex: 1, padding: 12 },
  orderTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  orderList: { flex: 1 },
  orderRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  orderItemName: { color: '#fff', fontSize: 13 },
  orderItemPrice: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginRight: 8 },
  removeBtn: { padding: 4 },
  removeBtnText: { color: '#ef4444', fontSize: 12, fontWeight: '700' },
  totals: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  totalRowBig: { marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  totalLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  totalValue: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  totalBig: { color: '#fff', fontSize: 18, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btnSecondary: {
    flex: 1, padding: 14, backgroundColor: '#1e293b', borderRadius: 10, alignItems: 'center',
  },
  btnSecondaryText: { color: '#fff', fontWeight: '600' },
  btnPrimary: {
    flex: 1, padding: 14, backgroundColor: '#059669', borderRadius: 10, alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
