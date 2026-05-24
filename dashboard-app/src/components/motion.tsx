'use client'

import { motion, AnimatePresence } from 'framer-motion'
import type { ReactNode } from 'react'

// ── Page transition wrapper ─────────────────────────────────────────────────

export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Fade in on scroll (viewport entry) ──────────────────────────────────────

export function FadeIn({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Stagger children ────────────────────────────────────────────────────────

const staggerContainer = {
  hidden: {} as const,
  show: {
    transition: { staggerChildren: 0.08 },
  } as const,
}

const staggerItem = {
  hidden: { opacity: 0, y: 16 } as const,
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } } as const,
}

export function StaggerList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  )
}

// ── Scale on hover (for cards) ──────────────────────────────────────────────

export function HoverCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Number counter animation ────────────────────────────────────────────────

export function CountUp({ value, className }: { value: number; className?: string }) {
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={className}
    >
      <motion.span
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        {value.toLocaleString()}
      </motion.span>
    </motion.span>
  )
}

// ── Slide in from side ──────────────────────────────────────────────────────

export function SlideIn({ children, className, direction = 'left', delay = 0 }: {
  children: ReactNode; className?: string; direction?: 'left' | 'right'; delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: direction === 'left' ? -30 : 30 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Pulse dot (for status indicators) ───────────────────────────────────────

export function PulseDot({ color = 'bg-emerald-500', className }: { color?: string; className?: string }) {
  return (
    <span className={`relative inline-flex ${className || ''}`}>
      <motion.span
        animate={{ scale: [1, 1.5, 1], opacity: [1, 0, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-40`}
      />
      <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
    </span>
  )
}

// Re-export motion for custom usage
export { motion, AnimatePresence }
