/** 会话列表与消息动作行共用的相对时间显示和刷新时钟。
 *
 * 单位随时间跨度自动放大：刚刚 → N分钟前 → 半小时前 → N小时前 → N天前 →
 * N个月前 → N年前。侧栏、消息时间、悬浮卡和自动化任务都走这一个 helper，
 * 不再各写一套「今天/昨天/前天」。
 */

import * as React from 'react'

const MINUTE = 60_000
const HALF_HOUR = 30 * MINUTE
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/**
 * @param {number} value 事件时间（Unix epoch ms）
 * @param {number} [now] 参考时间，默认当前时间
 * @returns {string} 相对时间标签；无效时间返回空串
 */
export function formatRelativeTime(value, now = Date.now()) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  const reference = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
  const future = value > reference
  const diff = Math.abs(reference - value)
  const suffix = future ? '后' : '前'
  if (diff < MINUTE) return future ? '即将' : '刚刚'
  if (diff < HALF_HOUR) return `${Math.floor(diff / MINUTE)}分钟${suffix}`
  if (diff < HOUR) return `半小时${suffix}`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时${suffix}`
  if (diff < MONTH) return `${Math.floor(diff / DAY)}天${suffix}`
  if (diff < YEAR) return `${Math.max(1, Math.floor(diff / MONTH))}个月${suffix}`
  return `${Math.max(1, Math.floor(diff / YEAR))}年${suffix}`
}

/* 所有订阅者共用同一个 30s 时钟，避免每条消息各起一个 interval。 */
let currentNow = Date.now()
let timer = null
const listeners = new Set()

function publish() {
  currentNow = Date.now()
  for (const listener of [...listeners]) listener()
}

function subscribe(listener) {
  if (listeners.size === 0 && timer === null) {
    currentNow = Date.now()
    timer = setInterval(publish, 30_000)
    queueMicrotask(publish)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getNow() {
  return currentNow
}

/** 订阅共享时钟；相对时间标签用它按 30s 刷新。 */
export function useRelativeNow() {
  return React.useSyncExternalStore(subscribe, getNow)
}
