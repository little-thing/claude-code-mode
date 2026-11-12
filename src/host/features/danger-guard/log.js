/** 安全日志：宿主上下文里的 `ctx.logger` 在部分注入作用域中会抛错，
 * `?.` 挡不住抛错，所以访问本身也要包起来。日志失败绝不能影响拦截本身。
 * @param {any} ctx
 * @param {'info'|'warn'|'debug'} level
 * @param {string} message
 */
export function safeLog(ctx, level, message) {
  try {
    const logger = ctx?.logger
    if (typeof logger?.[level] === 'function') logger[level](message)
  } catch {
    /* 日志不可用：静默 */
  }
}
