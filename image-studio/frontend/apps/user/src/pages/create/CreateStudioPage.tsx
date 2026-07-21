import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  Expand,
  FileImage,
  Loader2,
  LogIn,
  LogOut,
  Paperclip,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import clsx from 'clsx';

import { useEnsureLoggedIn } from '../../hooks/useEnsureLoggedIn';
import { ApiError } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import { genApi } from '../../lib/services';
import type { GenerationTask } from '../../lib/types';
import { useAuthStore } from '../../stores/auth';
import { useLoginGateStore } from '../../stores/loginGate';
import { toast } from '../../stores/toast';

const IMAGE_MODELS = [
  { code: 'gpt-image-2', label: 'GPT Image 2', cost: 0 },
];

const IMAGE_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9'] as const;
const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;
const HISTORY_PAGE_SIZE = 40;
const MAX_ATTACHMENTS = 5;

const GENERATING_PHRASES = [
  '正在调度图像能力',
  '画面结构正在生成',
  '细节与光影正在收束',
  '作品即将完成',
];

const SUGGESTIONS = [
  {
    title: '高级产品广告',
    image: '/examples/case-1.jpg',
    prompt: 'A premium minimalist product advertisement, a clean hero product on a white stone podium, soft studio light, restrained luxury editorial layout, crisp typography, high-end commercial photography, 1:1',
  },
  {
    title: '城市视觉海报',
    image: '/examples/case-2.jpg',
    prompt: 'A cinematic city poster for Shanghai at night, layered neon reflections, elegant editorial composition, strong foreground subject, rich atmosphere, premium travel campaign visual, 9:16',
  },
  {
    title: '3D 手办工作流',
    image: '/examples/case-3.jpg',
    prompt: 'Photorealistic studio photo of a collectible character figurine on a clean desk, behind it two monitors showing the same character in sculpting and final render views, premium 3D design studio, detailed resin material, cinematic lighting, 4:5',
  },
  {
    title: '国风影视海报',
    image: '/examples/case-4.jpg',
    prompt: 'A dramatic Chinese historical fantasy movie poster, expressive characters, silk costume details, ink-wash atmosphere mixed with cinematic lighting, refined facial details, poster-grade composition, 3:4',
  },
  {
    title: '信息图封面',
    image: '/examples/case-5.jpg',
    prompt: 'A high-end 3D infographic cover about human evolution, realistic stone steps, clean labels, premium museum exhibition visual, warm parchment background, clear hierarchy, detailed but not crowded, 16:9',
  },
];

function withAppBasePath(url?: string) {
  const value = (url || '').trim();
  if (!value) return '';
  if (value.startsWith('data:') || value.startsWith('blob:') || /^(?:https?:)?\/\//i.test(value)) return value;
  if (!value.startsWith('/')) return value;

  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  if (!base || base === '') return value;
  if (value === base || value.startsWith(`${base}/`)) return value;
  return `${base}${value}`;
}

export default function ImageStudioPage() {
  const qc = useQueryClient();
  const ensureLoggedIn = useEnsureLoggedIn();
  const token = useAuthStore((s) => s.token);
  const me = useAuthStore((s) => s.me);
  const logout = useAuthStore((s) => s.logout);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const openGate = useLoginGateStore((s) => s.openGate);

  const [prompt, setPrompt] = useState('');
  const [imageModel, setImageModel] = useState(IMAGE_MODELS[0]!.code);
  const [imageRatio, setImageRatio] = useState<(typeof IMAGE_RATIOS)[number]>('1:1');
  const [imageResolution, setImageResolution] = useState<(typeof IMAGE_RESOLUTIONS)[number]>('1K');
  const [count, setCount] = useState(1);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; dataUrl: string }>>([]);
  const [task, setTask] = useState<GenerationTask | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const pollRef = useRef<number | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const imageModels = IMAGE_MODELS;

  useEffect(() => {
    void refreshMe();
  }, [refreshMe, token]);

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
    el.style.overflowY = el.scrollHeight > 260 ? 'auto' : 'hidden';
  }, [prompt]);

  const history = useQuery({
    queryKey: ['gen.history', 'image-only', token],
    enabled: !!token,
    queryFn: () => genApi.history({ kind: 'image', page: 1, page_size: HISTORY_PAGE_SIZE }),
  });

  const deleteHistory = useMutation({
    mutationFn: () => genApi.deleteHistory('failed'),
    onSuccess: (res) => {
      toast.success(`已清理 ${res.deleted} 条失败记录`);
      qc.invalidateQueries({ queryKey: ['gen.history'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '清理失败'),
  });

  const createImage = useMutation({
    mutationFn: () => genApi.createImage({
      model: imageModel,
      prompt,
      count,
      ratio: imageRatio,
      quality: 'hd',
      ref_assets: attachments.map((item) => item.dataUrl),
      mode: attachments.length ? 'i2i' : 't2i',
      params: { resolution: imageResolution, quality: 'high' },
    }),
    onSuccess: (nextTask) => {
      setTask(nextTask);
      startPolling(nextTask.task_id);
      void refreshMe();
      qc.invalidateQueries({ queryKey: ['gen.history'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '生成失败'),
  });

  const inProgress = task && (task.status === 0 || task.status === 1);
  const expectedCost = (imageModels.find((m) => m.code === imageModel)?.cost ?? 0) * count;
  const resultItems = useMemo(() => {
    const visible = (item: GenerationTask) => item.kind === 'image' && item.status !== 4;
    const current = task && visible(task) ? [task] : [];
    const rest = (history.data?.list ?? []).filter(visible);
    return [...current, ...rest].filter((item, idx, arr) => arr.findIndex((x) => x.task_id === item.task_id) === idx);
  }, [history.data?.list, task]);

  const startPolling = (taskId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const fresh = await genApi.getTask(taskId);
        setTask(fresh);
        if ([2, 3, 4].includes(fresh.status)) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          if (fresh.status === 2) toast.success('图片生成完成');
          else if (fresh.status === 3) toast.error(fresh.error || '生成失败');
          else toast.info('已退款');
          await refreshMe();
          qc.invalidateQueries({ queryKey: ['gen.history'] });
        }
      } catch {
        // keep polling quietly
      }
    }, 1500);
  };

  const submit = () => {
    if (!prompt.trim()) {
      toast.info('先描述你想生成的图片');
      return;
    }
    ensureLoggedIn(() => createImage.mutate(), '登录后即可生成和保存图片');
  };

  const readFileAsDataURL = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read file failed'));
    reader.readAsDataURL(file);
  });

  const handleAttachFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) {
      toast.info('请选择图片文件');
      return;
    }
    const slots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    if (slots <= 0) {
      toast.info(`最多上传 ${MAX_ATTACHMENTS} 张参考图`);
      return;
    }
    try {
      const data = await Promise.all(imageFiles.slice(0, slots).map(async (file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        dataUrl: await readFileAsDataURL(file),
      })));
      setAttachments((prev) => [...prev, ...data]);
      if (imageFiles.length > slots) toast.info(`已保留前 ${MAX_ATTACHMENTS} 张参考图`);
    } catch {
      toast.error('读取图片失败');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onLogout = async () => {
    await logout();
    toast.info('已退出登录');
  };

  return (
    <div className="image-studio-shell min-h-screen bg-[#f6f7f4] text-neutral-950">
      <header className="image-studio-topbar">
        <a className="image-studio-brand" href="/">
          <span className="image-studio-brand-mark"><Sparkles size={18} /></span>
          <span>Image Studio</span>
        </a>
        <div className="image-studio-user">
          <a className="image-studio-link" href={`${window.location.origin}/cockpit/`}>Cockpit</a>
          {token ? (
            <>
              <span className="image-studio-points">{formatPoints(me?.points)} 点</span>
              <button className="image-studio-icon-btn" type="button" onClick={onLogout} title="退出">
                <LogOut size={17} />
              </button>
            </>
          ) : (
            <button className="image-studio-login" type="button" onClick={() => openGate({ hint: '登录后即可生成图片' })}>
              <LogIn size={16} />
              登录
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1480px] gap-6 px-4 pb-12 pt-6 sm:px-7 lg:grid-cols-[minmax(360px,520px)_1fr] lg:px-10">
        <section className="image-studio-composer">
          <div className="image-studio-kicker"><Wand2 size={15} /> 单一能力 · 高质量生图</div>
          <h1>把想法直接变成图片</h1>
          <p className="image-studio-subtitle">从灵感草图到成片，专注一张高质量视觉的生成、参考与迭代。</p>

          <div className="image-studio-prompt-card">
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述画面主体、风格、构图、光线、比例和你想保留的细节..."
              className="studio-prompt image-studio-textarea"
              maxLength={5000}
            />
            <div className="image-studio-controls">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handleAttachFiles(e.target.files)}
              />
              <button className="image-studio-round-btn" type="button" onClick={() => fileInputRef.current?.click()} title="上传参考图">
                <Paperclip size={18} />
              </button>
              <ComposerSelect
                value={imageModel}
                onChange={setImageModel}
                options={imageModels.map((m) => ({ value: m.code, label: m.label }))}
                wide
              />
              <ComposerSelect value={imageRatio} onChange={(v) => setImageRatio(v as typeof IMAGE_RATIOS[number])} options={IMAGE_RATIOS.map((r) => ({ value: r, label: r }))} />
              <ComposerSelect value={imageResolution} onChange={(v) => setImageResolution(v as typeof IMAGE_RESOLUTIONS[number])} options={IMAGE_RESOLUTIONS.map((r) => ({ value: r, label: r }))} />
              <ComposerSelect value={String(count)} onChange={(v) => setCount(Number(v))} options={[1, 2, 4].map((n) => ({ value: String(n), label: `${n}张` }))} />
              <button
                className="image-studio-submit"
                type="button"
                onClick={submit}
                disabled={!!inProgress || createImage.isPending}
                title="生成图片"
              >
                {inProgress || createImage.isPending ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
              </button>
            </div>
            {attachments.length > 0 && (
              <div className="image-studio-refs">
                {attachments.map((item) => (
                  <div key={item.id} className="image-studio-ref">
                    <img src={item.dataUrl} alt={item.name} />
                    <button type="button" onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== item.id))} title="移除">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="image-studio-meta">
            <span>预估消耗：{expectedCost ? `${expectedCost} 点` : '按当前配置'}</span>
            <span>{attachments.length ? `参考图 ${attachments.length}/${MAX_ATTACHMENTS}` : '支持参考图'}</span>
          </div>

          <div className="image-studio-suggestions">
            {SUGGESTIONS.map((item) => (
              <button key={item.title} type="button" onClick={() => setPrompt(item.prompt)}>
                <img src={withAppBasePath(item.image)} alt="" loading="lazy" />
                <span>{item.title}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="image-studio-gallery">
          <div className="image-studio-gallery-head">
            <div>
              <h2>图片作品</h2>
              <p>{token ? '最近生成的图片会保存在这里' : '登录后会显示你的生成记录'}</p>
            </div>
            <button className="image-studio-clear" type="button" disabled={!token || deleteHistory.isPending} onClick={() => deleteHistory.mutate()}>
              <Trash2 size={15} />
              清理失败项
            </button>
          </div>

          {resultItems.length === 0 ? (
            <div className="image-studio-empty">
              <FileImage size={32} />
              <span>{token ? '还没有图片作品' : '登录后显示图片作品'}</span>
            </div>
          ) : (
            <div className="image-studio-masonry">
              {resultItems.map((item) => <WorkCard key={item.task_id} item={item} onOpen={setPreview} />)}
            </div>
          )}
        </section>
      </main>
      {preview && <PreviewLightbox preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function ComposerSelect({ value, options, onChange, disabled, wide }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={clsx('image-studio-select', wide && 'image-studio-select-wide', open && 'is-open')}
      >
        <span>{current?.label}</span>
        <ChevronDown size={15} className={clsx('transition', open && 'rotate-180')} />
      </button>

      {open && !disabled && (
        <div className={clsx('image-studio-select-menu', wide && 'image-studio-select-menu-wide')}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={clsx(selected && 'selected')}
              >
                <span>{o.label}</span>
                {selected && <Check size={16} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkCard({ item, onOpen }: { item: GenerationTask; onOpen: (preview: { url: string; title: string }) => void }) {
  const result = item.results?.[0];
  const original = withAppBasePath(result?.url);
  const [loadedRatio, setLoadedRatio] = useState<string | null>(null);
  const declaredRatio = result?.width && result?.height ? `${result.width} / ${result.height}` : '';
  const mediaRatio = loadedRatio || declaredRatio || '1 / 1';
  const canOpen = item.status === 2 && !!original;
  const prompt = compactPrompt(item.prompt);

  return (
    <article className="image-studio-work-card">
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => original && onOpen({ url: original, title: item.model })}
        style={{ aspectRatio: mediaRatio }}
        className={clsx('image-studio-work-media', canOpen && 'can-open')}
      >
        {original ? (
          <img
            src={original}
            alt=""
            loading="lazy"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) setLoadedRatio(`${img.naturalWidth} / ${img.naturalHeight}`);
            }}
          />
        ) : item.status === 1 || item.status === 0 ? (
          <GeneratingDots />
        ) : (
          <div className="image-studio-card-status">
            <FileImage size={24} />
            <span>{statusText(item.status)}</span>
          </div>
        )}
        {canOpen && (
          <span className="image-studio-card-open"><Expand size={18} /></span>
        )}
      </button>
      <div className="image-studio-card-caption">
        <span>{fmtRelative(item.created_at)}</span>
        {prompt && <strong>{prompt}</strong>}
      </div>
    </article>
  );
}

function GeneratingDots() {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhraseIndex((idx) => (idx + 1) % GENERATING_PHRASES.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="generating-dots" aria-label="正在生成图片">
      <div className="generating-dots__phrases">
        <span className="generating-dots__phrase generating-dots__phrase--active" key={phraseIndex}>
          {GENERATING_PHRASES[phraseIndex]}
        </span>
      </div>
    </div>
  );
}

function PreviewLightbox({ preview, onClose }: { preview: { url: string; title: string }; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={onClose}>
      <div className="relative max-h-[92vh] max-w-[92vw]" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="image-studio-lightbox-close" title="关闭">
          <X size={18} />
        </button>
        <a className="image-studio-lightbox-download" href={preview.url} download title="下载图片">
          <Download size={18} />
        </a>
        <img src={preview.url} alt={preview.title} className="max-h-[92vh] max-w-[92vw] rounded-[18px] object-contain shadow-2xl" />
      </div>
    </div>
  );
}

function compactPrompt(prompt?: string) {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 34 ? text.slice(0, 34) + '...' : text;
}

function statusText(status: number) {
  if (status === 2) return '已完成';
  if (status === 3) return '失败';
  if (status === 4) return '已退款';
  if (status === 1) return '生成中';
  return '排队中';
}

function formatPoints(points?: number) {
  if (typeof points !== 'number') return '0';
  return String(Math.floor(points / 100));
}
