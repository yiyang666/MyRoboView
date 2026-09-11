import React, { useEffect } from 'react';
import './OperatorSheet.css';

/**
 * 底部抽屉：主屏地图优先，操作面板从此弹出
 */
export default function OperatorSheet({ open, title, onClose, children }) {
  // 打开抽屉时禁止背景滚动
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="operator-sheet" role="presentation">
      <button
        type="button"
        className="operator-sheet__backdrop"
        aria-label="关闭面板"
        onClick={onClose}
      />
      <section className="operator-sheet__panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="operator-sheet__header">
          <h2 className="operator-sheet__title">{title}</h2>
          <button type="button" className="operator-sheet__close" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="operator-sheet__body">{children}</div>
      </section>
    </div>
  );
}
