import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn, X } from 'lucide-react';
import clsx from 'clsx';

import { ApiError } from '../lib/api';
import { authApi } from '../lib/services';
import { useAuthStore } from '../stores/auth';
import { useLoginGateStore } from '../stores/loginGate';
import { toast } from '../stores/toast';

const loginSchema = z.object({
  account: z.string().min(3, '账号至少 3 位'),
  password: z.string().min(6, '密码至少 6 位'),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginGate() {
  const open = useLoginGateStore((s) => s.open);
  const hint = useLoginGateStore((s) => s.hint);
  const closeGate = useLoginGateStore((s) => s.closeGate);
  const resolve = useLoginGateStore((s) => s.resolve);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGate();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, closeGate]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="登录生图工作台"
      className="fixed inset-0 z-[80] grid place-items-center px-4 py-10"
    >
      <button
        aria-label="关闭"
        type="button"
        className="absolute inset-0 bg-black/35 backdrop-blur-sm"
        onClick={closeGate}
      />

      <div className="relative w-full max-w-[440px] overflow-hidden rounded-[28px] border border-neutral-200 bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,.18)] klein-fade-in">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[26px] font-medium leading-tight text-neutral-950">
              登录生图工作台
            </h2>
            <p className="mt-2 text-[15px] text-neutral-500">{hint}</p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950"
            onClick={closeGate}
          >
            <X size={20} />
          </button>
        </div>

        <div className="py-6">
          <LoginForm onDone={resolve} />
        </div>

        <p className="text-center text-xs text-neutral-400">只用于生成图片与保存图片历史</p>
      </div>
    </div>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const setToken = useAuthStore((s) => s.setToken);
  const refreshMe = useAuthStore((s) => s.refreshMe);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { account: '', password: '' },
  });

  const onSubmit = async (v: LoginValues) => {
    try {
      const resp = await authApi.login({ account: v.account, password: v.password });
      setToken(resp.token);
      await refreshMe();
      toast.success('登录成功');
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '登录失败，请重试');
    }
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="field">
        <input
          className={clsx('input h-14 rounded-2xl text-[15px] font-normal placeholder:font-normal', errors.account && 'input-error')}
          placeholder="邮箱 / 手机号 / 用户名"
          autoComplete="username"
          {...register('account')}
        />
        {errors.account && <p className="field-error">{errors.account.message}</p>}
      </div>
      <div className="field">
        <input
          className={clsx('input h-14 rounded-2xl text-[15px] font-normal placeholder:font-normal', errors.password && 'input-error')}
          type="password"
          placeholder="密码"
          autoComplete="current-password"
          {...register('password')}
        />
        {errors.password && <p className="field-error">{errors.password.message}</p>}
      </div>
      <button className="btn btn-primary btn-lg btn-block h-14 text-[17px]" type="submit" disabled={isSubmitting}>
        {isSubmitting ? '登录中...' : <><LogIn size={18} /> 登录并继续</>}
      </button>
    </form>
  );
}
