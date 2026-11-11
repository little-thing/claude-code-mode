/** 插件版本：构建时由 build.mjs 从 package.json 注入（`__CT_VERSION__`）。
 *
 * 不要在代码里手写版本号；直接运行源码（未经构建）时退回 `dev`。
 */
/* global __CT_VERSION__ */
export const PLUGIN_VERSION = typeof __CT_VERSION__ === 'string' ? __CT_VERSION__ : 'dev'
