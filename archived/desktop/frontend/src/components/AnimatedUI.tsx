/**
 * 共享动效预设(移植自 Forsion-AI-Studio client/components/AnimatedUI.tsx,
 * 布局类改为 base.css 的语义类;弹簧参数原样保留 —— forsion-ui 规范:必须带 scale、
 * damping ratio < 1)。
 */
import React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

/** 折叠展开容器(思考块/工具卡片体/侧栏会话列表)。easing 取「agent 切换」同款 spring 曲线;
 *  尊重系统的「减少动态效果」(reduced motion → 瞬时)。 */
export const AnimatedCollapse: React.FC<{ open: boolean; children: React.ReactNode }> = ({ open, children }) => {
  const rm = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: rm ? 0 : 0.24, ease: [0.2, 0.8, 0.3, 1] }}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
