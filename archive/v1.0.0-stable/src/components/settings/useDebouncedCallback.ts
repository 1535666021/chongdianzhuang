/* ============================================================
 * 输入即存防抖 Hook（设置页「输入即存」专用，默认 500ms）
 * 行为：
 * - 连续输入合并为一次保存：每次调用重置计时，静置 delay 后才执行
 * - 回调始终取最新渲染闭包（直接读最新 state，无需额外 ref 镜像）
 * - 组件卸载时若仍有挂起调用，立即同步 flush
 *   （二级页返回上一级时最后一击输入不丢失）
 * ============================================================ */

import { useEffect, useRef } from "react";

/**
 * 生成防抖版回调：连续调用只执行最后一次（静置 delay 后）；
 * 卸载时挂起调用立即 flush。
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delay = 500,
): (...args: A) => void {
  /* 每次渲染同步最新回调：触发时读到的是最新 state 闭包 */
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgsRef = useRef<A | null>(null);

  const flushPending = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingArgsRef.current !== null) {
      const args = pendingArgsRef.current;
      pendingArgsRef.current = null;
      callbackRef.current(...args);
    }
  };

  /* 卸载兜底：挂起的保存立即执行（仅卸载时跑一次） */
  useEffect(() => flushPending, []);

  return (...args: A) => {
    pendingArgsRef.current = args;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (pendingArgsRef.current !== null) {
        const firedArgs = pendingArgsRef.current;
        pendingArgsRef.current = null;
        callbackRef.current(...firedArgs);
      }
    }, delay);
  };
}
