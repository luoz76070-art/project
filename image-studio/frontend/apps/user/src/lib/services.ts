// 高层 API 服务：分领域封装，UI 层只看 services.* 不直接 import axios。
import { request } from './api';
import type {
  CreateImageBody,
  GenerationTask,
  LoginResp,
  MeResp,
  PageData,
  TokenPair,
} from './types';

export const authApi = {
  login: (body: { account: string; password: string }) =>
    request<LoginResp>({ method: 'POST', url: '/auth/login', data: body }),
  refresh: (refresh_token: string) =>
    request<TokenPair>({ method: 'POST', url: '/auth/refresh', data: { refresh_token } }),
  logout: () => request<null>({ method: 'POST', url: '/auth/logout' }),
  me: () => request<MeResp>({ method: 'GET', url: '/users/me' }),
};

export const genApi = {
  createImage: (body: CreateImageBody, idemKey?: string) =>
    request<GenerationTask>({
      method: 'POST',
      url: '/gen/image',
      data: body,
      headers: idemKey ? { 'Idempotency-Key': idemKey } : undefined,
    }),
  getTask: (taskId: string) =>
    request<GenerationTask>({ method: 'GET', url: `/gen/tasks/${taskId}` }),
  history: (params: { kind?: 'image'; page?: number; page_size?: number } = {}) =>
    request<PageData<GenerationTask>>({
      method: 'GET',
      url: '/gen/history',
      params: {
        kind: params.kind,
        page: params.page ?? 1,
        page_size: params.page_size ?? 20,
      },
    }),
  deleteHistory: (scope: 'before_3d' | 'before_7d' | 'failed' | 'all') =>
    request<{ deleted: number }>({ method: 'DELETE', url: '/gen/history', params: { scope } }),
};
