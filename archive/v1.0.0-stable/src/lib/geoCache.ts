/* ============================================================
 * 地理编码服务：高德 REST API + localStorage 缓存
 * 规范：全项目唯一的地图能力入口，页面/组件禁止直接调用高德原生API
 * 流程：查缓存 → 命中直接返回 → 未命中请求高德 → 写缓存
 * ============================================================ */

import { loadGeoCache, saveGeoCache } from "@/lib/storage";
import type { GeoPoint } from "@/lib/storage";

/** 高德地理编码接口地址（REST，无需加载 JS SDK） */
const AMAP_GEOCODE_URL = "https://restapi.amap.com/v3/geocode/geo";

/** 内存级缓存：同一会话内避免重复读 localStorage */
let memoryCache: Record<string, GeoPoint> | null = null;

function getCache(): Record<string, GeoPoint> {
  if (memoryCache === null) {
    memoryCache = loadGeoCache();
  }
  return memoryCache;
}

function setCacheEntry(address: string, point: GeoPoint): void {
  const cache = getCache();
  cache[address] = point;
  memoryCache = cache;
  saveGeoCache(cache);
}

/** 同步取缓存坐标（无网络请求）；未命中返回 null */
export function getCachedGeo(address: string): GeoPoint | null {
  const key = address.trim();
  if (!key) return null;
  return getCache()[key] ?? null;
}

export interface GeocodeResult {
  point: GeoPoint | null;
  /** 是否来自本地缓存 */
  fromCache: boolean;
  /** 错误信息；为 null 表示成功（point 可能为 null = 地址未解析到） */
  error: string | null;
}

/**
 * 地址 → 经纬度。
 * @param address 安装地址
 * @param amapKey 设置页配置的高德 Key；为空时只查缓存
 */
export async function geocodeAddress(
  address: string,
  amapKey: string,
): Promise<GeocodeResult> {
  const key = address.trim();
  if (!key) {
    return { point: null, fromCache: false, error: "地址为空" };
  }

  const cached = getCachedGeo(key);
  if (cached) {
    return { point: cached, fromCache: true, error: null };
  }

  if (!amapKey.trim()) {
    return {
      point: null,
      fromCache: false,
      error: "未配置高德 Key，请在 设置 页填写后再解析地址",
    };
  }

  try {
    const url = `${AMAP_GEOCODE_URL}?address=${encodeURIComponent(key)}&key=${encodeURIComponent(amapKey.trim())}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { point: null, fromCache: false, error: `地理编码请求失败（HTTP ${res.status}）` };
    }
    const data = (await res.json()) as {
      status: string;
      info?: string;
      geocodes?: { location: string }[];
    };
    if (data.status !== "1") {
      return {
        point: null,
        fromCache: false,
        error: `地理编码失败：${data.info ?? "未知错误"}`,
      };
    }
    const location = data.geocodes?.[0]?.location;
    if (!location) {
      return { point: null, fromCache: false, error: null };
    }
    const [lng, lat] = location.split(",").map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return { point: null, fromCache: false, error: "坐标格式异常" };
    }
    const point: GeoPoint = { longitude: lng, latitude: lat };
    setCacheEntry(key, point);
    return { point, fromCache: false, error: null };
  } catch {
    return { point: null, fromCache: false, error: "网络异常，地理编码请求未发出" };
  }
}

/** 生成高德地图 URI 跳转链接（订单卡片"导航"用，APP/网页自适应） */
export function buildAmapNaviUrl(point: GeoPoint, name: string): string {
  return `https://uri.amap.com/marker?position=${point.longitude},${point.latitude}&name=${encodeURIComponent(name)}&callnative=1`;
}

/** 清空地理编码缓存（设置页可手动清理） */
export function clearGeoMemoryCache(): void {
  memoryCache = null;
}
