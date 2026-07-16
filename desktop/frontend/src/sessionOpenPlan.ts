// 「点会话 → 落哪个主 leaf」的纯决策(与引擎/store 解耦,方便单测)。
// chat leaf 支持两态:followActive(跟随全局 activeId,即「主聊天」)/ 固定会话(followActive:false + sessionId)。
//  - follow:焦点已在「跟随主聊天」→ 切 activeId 即可,leaf 自随。
//  - pin:焦点在空白新标签 / 笔记 / 固定到别的会话的聊天 → 就地把它固定成该会话的聊天(修「新标签点会话却替换旧视图」)。
//  - fresh:主区无 leaf → 兜底新建主聊天。

export interface FocusedLeaf { type?: string; followActive?: boolean }

export function planSessionOpen(focused: FocusedLeaf | null): 'follow' | 'pin' | 'fresh' {
  if (!focused) return 'fresh'
  if (focused.type === 'chat' && focused.followActive !== false) return 'follow'
  return 'pin'
}
