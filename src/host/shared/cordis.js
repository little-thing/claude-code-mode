/** Cordis 宿主侧共用的小工具。
 *
 * DSH 的服务在 Cordis 里可能以“视图对象”出现，方法覆盖必须落在背后的原始实例上，
 * 否则网关/代理读不到。这个符号是 DSH 内部约定的同一个 key。
 */

/** Cordis 服务视图背后的原始实例。 */
export const CORDIS_ORIGINAL = Symbol.for('cordis.original')

/**
 * 取服务背后的原始实例；不是视图对象时原样返回。
 * @param {any} service
 * @returns {any}
 */
export function originalOf(service) {
  const original = service?.[CORDIS_ORIGINAL]
  return original !== null && typeof original === 'object' ? original : service
}