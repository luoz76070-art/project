import { createContext, useContext, useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ImageIcon, X, RotateCw, Maximize2 } from "lucide-react";
import { apiPost, buildUrl } from "../connection/http";
import { imageSource } from "./imageSources";

type ImageLoader = (path: string, signal: AbortSignal) => Promise<string>;
const ImageContext = createContext<ImageLoader | null>(null);
export function MessageMediaProvider({ endpoint, token, threadId, children }: { endpoint: string; token: string; threadId: string; children: ReactNode }) {
  const loader = useMemo<ImageLoader>(() => async (path, signal) => {
    if (!threadId || !token) throw new Error("请先连接电脑并打开图片所在会话。");
    try {
      const result = await apiPost<{ dataUrl: string }>(buildUrl(endpoint, `/api/threads/${encodeURIComponent(threadId)}/images`), token, { path }, signal);
      if (typeof result.dataUrl !== "string" || imageSource(result.dataUrl).kind !== "remote" || !result.dataUrl.startsWith("data:image/")) throw new Error("图片响应无效。");
      return result.dataUrl;
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : 0;
      if (status === 403) throw new Error("图片位于此会话项目之外，请将图片放到项目目录再引用。");
      if (status === 404) throw new Error("未找到图片，或电脑网关尚未升级到支持图片的版本。");
      if (status === 413) throw new Error("图片超过 8 MB，请压缩后重试。");
      if (status === 415) throw new Error("暂不支持此图片格式，请使用 PNG、JPEG、GIF、WebP 或 AVIF。");
      throw error;
    }
  }, [endpoint, token, threadId]);
  return <ImageContext.Provider value={loader}>{children}</ImageContext.Provider>;
}

export function MessageImage({ source, alt }: { source: string; alt: string }) {
  const loader = useContext(ImageContext);
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (!container.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setUrl(""); setError(""); setPreview(false);
    if (!visible) return;
    const controller = new AbortController();
    const parsed = imageSource(source);
    if (parsed.kind === "remote") setUrl(parsed.value);
    else if (parsed.kind === "invalid") setError("图片地址或格式不受支持。");
    else if (!loader) setError("当前会话暂不支持读取电脑本地图片。");
    else void loader(parsed.value, controller.signal).then(value => { if (!controller.signal.aborted) setUrl(value); }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "图片加载失败。");
    });
    return () => controller.abort();
  }, [source, loader, visible, attempt]);
  return <span ref={container} className="message-image">
    {url && !error ? <button type="button" className="message-image-open" onClick={() => setPreview(true)} aria-label={`查看大图：${alt || "图片"}`}><img src={url} alt={alt || "电脑图片"} referrerPolicy="no-referrer" onError={() => setError("图片无法加载，请检查文件或网络后重试。")} /></button>
      : <span className="image-placeholder" role="status"><ImageIcon size={20} /><span>{error || (visible ? "正在加载图片…" : "图片")}</span>{error && <button type="button" onClick={() => { setVisible(true); setAttempt(value => value + 1); }}><RotateCw size={14} />重试</button>}</span>}
    {alt && <span className="message-image-caption">{alt}</span>}
    {preview && !error && <ImagePreview url={url} alt={alt} close={() => setPreview(false)} />}
  </span>;
}
function ImagePreview({ url, alt, close }: { url: string; alt: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [original, setOriginal] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  return createPortal(<dialog ref={ref} className="image-preview" onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header><span>{alt || "图片预览"}</span><button type="button" onClick={() => setOriginal(value => !value)}><Maximize2 size={18} />{original ? "适应屏幕" : "原尺寸"}</button><button type="button" onClick={close} aria-label="关闭图片预览"><X size={22} /></button></header>
    <div className={original ? "image-preview-scroll original" : "image-preview-scroll"}><img src={url} alt={alt || "电脑图片"} referrerPolicy="no-referrer" /></div>
  </dialog>, document.body);
}
