// 登录浮层状态机：
// - 任何位置调用 useLoginGate().require(action) 即可
//   * 已登录：直接执行 action
//   * 未登录：打开浮层，登录成功后自动执行 action
// - 浮层内部由 <LoginGate /> 渲染（在 App.tsx 挂一份）
import { create } from 'zustand';

interface LoginGateState {
  open: boolean;
  /** 登录成功后回调（用于断点续做被拦截的动作） */
  pending: (() => void) | null;
  /** 引导文案（不同业务可自定义，如 "登录后即可生成"） */
  hint: string;
  openGate: (opts?: { hint?: string; onLoggedIn?: () => void }) => void;
  closeGate: () => void;
  /** 内部使用：登录成功时触发 */
  resolve: () => void;
}

export const useLoginGateStore = create<LoginGateState>((set, get) => ({
  open: false,
  pending: null,
  hint: '登录后即可继续',

  openGate: (opts) =>
    set({
      open: true,
      hint: opts?.hint ?? '登录后即可继续',
      pending: opts?.onLoggedIn ?? null,
    }),

  closeGate: () => set({ open: false, pending: null }),

  resolve: () => {
    const cb = get().pending;
    set({ open: false, pending: null });
    if (cb) {
      // 让 zustand state 先 commit，再回放动作
      Promise.resolve().then(cb);
    }
  },
}));
