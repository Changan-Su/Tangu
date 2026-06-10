/**
 * 共享动效预设(移植自 Forsion-AI-Studio client/components/AnimatedUI.tsx,
 * 布局类改为 base.css 的语义类;弹簧参数原样保留 —— forsion-ui 规范:必须带 scale、
 * damping ratio < 1)。
 */
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Transition } from 'framer-motion'

export { AnimatePresence }

export const appleSpring: Transition = { type: 'spring', stiffness: 350, damping: 30, mass: 0.8 }
export const gentleSpring: Transition = { type: 'spring', stiffness: 260, damping: 24, mass: 0.9 }
export const snappySpring: Transition = { type: 'spring', stiffness: 400, damping: 28 }

const quickFade: Transition = { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }

export const AnimatedModalBackdrop: React.FC<{
  children: React.ReactNode
  onClose?: () => void
  zIndex?: number
}> = ({ children, onClose, zIndex = 50 }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={quickFade}
    className="u-backdrop"
    style={{ zIndex }}
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose?.()
    }}
  >
    {children}
  </motion.div>
)

export const AnimatedModalContent: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.96, y: 8 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.97, y: 4 }}
    transition={appleSpring}
    className={className}
    style={{ transformOrigin: 'center' }}
  >
    {children}
  </motion.div>
)

/** 折叠展开容器(思考块/工具卡片体)。 */
export const AnimatedCollapse: React.FC<{ open: boolean; children: React.ReactNode }> = ({ open, children }) => (
  <AnimatePresence initial={false}>
    {open && (
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
        style={{ overflow: 'hidden' }}
      >
        {children}
      </motion.div>
    )}
  </AnimatePresence>
)
