// PIN login screen — mirrors dashboard-app POS layout
import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native'
import { supabase } from '@/lib/supabase'
import { usePOSStore } from '@/lib/store'

const MAX_ATTEMPTS = 5

export default function LoginScreen() {
  const [pin, setPin] = useState('')
  const [checking, setChecking] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const setStaff = usePOSStore((s) => s.setStaff)

  const handleSubmit = async () => {
    if (pin.length < 4 || attempts >= MAX_ATTEMPTS) return
    setChecking(true)

    try {
      const { data, error } = await supabase
        .from('pos_staff')
        .select('id, name, role, pin, active')
        .eq('pin', pin)
        .eq('active', true)
        .eq('client_id', 'amalay')
        .limit(1)

      if (!error && data && data.length > 0) {
        setStaff(data[0])
        setAttempts(0)
        setPin('')
        return
      }
    } catch {
      // DB not available
    }

    const newAttempts = attempts + 1
    setAttempts(newAttempts)
    setPin('')

    if (newAttempts >= MAX_ATTEMPTS) {
      Alert.alert('Bloqueado', 'Demasiados intentos. Espera 1 minuto.')
      setTimeout(() => setAttempts(0), 60000)
    } else {
      Alert.alert('Error', 'PIN incorrecto')
    }

    setChecking(false)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>fullsite</Text>
      <Text style={styles.subtitle}>POS — Ingresa tu PIN</Text>

      <TextInput
        style={styles.input}
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
        onSubmitEditing={handleSubmit}
        placeholder="PIN"
        placeholderTextColor="#666"
        keyboardType="number-pad"
        maxLength={4}
        secureTextEntry
        autoFocus
      />

      <TouchableOpacity
        style={[styles.button, (pin.length < 4 || checking) && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={pin.length < 4 || checking}
      >
        <Text style={styles.buttonText}>
          {checking ? 'Verificando...' : 'Entrar'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  logo: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -1,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 4,
    marginBottom: 32,
  },
  input: {
    width: '100%',
    maxWidth: 280,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 28,
    textAlign: 'center',
    letterSpacing: 12,
    marginBottom: 16,
  },
  button: {
    width: '100%',
    maxWidth: 280,
    backgroundColor: '#059669',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#334155',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
})
