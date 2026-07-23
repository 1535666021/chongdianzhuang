/* ============================================================
 * 下拉选项自动收集模块
 * 从所有订单中提取去重值，新订单自动收集，持久化到 localStorage
 * ============================================================ */

import type { Order } from "@/types";

const STORAGE_KEY = "cp_dropdown_options";

export interface DropdownOptions {
  platforms: string[];
  powerValues: number[];
}

export function loadDropdownOptions(): DropdownOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { platforms: [], powerValues: [] };
    return JSON.parse(raw);
  } catch {
    return { platforms: [], powerValues: [] };
  }
}

export function saveDropdownOptions(opts: DropdownOptions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
}

export function collectFromOrders(orders: Order[]): DropdownOptions {
  const platforms = [...new Set(orders.map((o) => o.platform).filter(Boolean))] as string[];
  const powerValues = [...new Set(orders.map((o) => o.powerKw).filter(Boolean))] as number[];
  return { platforms, powerValues };
}

export function addOrderToOptions(opts: DropdownOptions, order: Order): DropdownOptions {
  const next: DropdownOptions = {
    platforms: [...opts.platforms],
    powerValues: [...opts.powerValues],
  };
  if (order.platform && !next.platforms.includes(order.platform)) {
    next.platforms.push(order.platform);
  }
  if (!next.powerValues.includes(order.powerKw)) {
    next.powerValues.push(order.powerKw);
  }
  return next;
}

export function getDropdownOptions(): DropdownOptions {
  return loadDropdownOptions();
}
