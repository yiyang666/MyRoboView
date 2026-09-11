import { useEffect, useState } from 'react';

/**
 * 现场壳（Operator Shell）判定的唯一来源。叶子组件不要再读 matchMedia / UA。
 *
 * 规则：
 * - 窄屏竖屏（典型手机）进入 Operator Shell
 * - 手机横屏宽度常 >768，改用「粗指针 + 横屏 + 矮视口」兜住
 * - 平板横屏通常仍走桌面 Console Shell
 */
export const OPERATOR_SHELL_MQ = [
  '(max-width: 768px)',
  '(max-height: 500px) and (orientation: landscape) and (pointer: coarse)',
].join(', ');

export function readOperatorShell() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(OPERATOR_SHELL_MQ).matches;
}

/** 登录后落地页：现场壳进中台，桌面壳进监控台首页 */
export function getPostLoginPath() {
  return readOperatorShell() ? '/operator' : '/';
}

export function useOperatorShell() {
  const [isOperatorShell, setIsOperatorShell] = useState(readOperatorShell);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(OPERATOR_SHELL_MQ);
    const sync = () => setIsOperatorShell(media.matches);
    sync();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync);
      return () => media.removeEventListener('change', sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  return isOperatorShell;
}
