/** 皮肤层：把一套皮肤的 CSS 挂到页面上，并打上 body 属性。
 *
 * 只做观感。切换皮肤 = 卸载旧样式 + 换 body 属性，功能层对此无感知。
 */

/**
 * @param {{ id: string, name?: string, css: string, accent?: string }} skin
 * @returns {() => void} teardown
 */
export function mountSkin(skin) {
  const attr = 'data-ct-skin'
  const styleId = `ct-skin-${skin.id}`
  const previous = document.body.getAttribute(attr)

  let style = document.getElementById(styleId)
  if (style === null) {
    style = document.createElement('style')
    style.id = styleId
    style.textContent = skin.css
    document.head.appendChild(style)
  }
  document.body.setAttribute(attr, skin.id)

  return () => {
    style?.remove()
    if (previous === null) document.body.removeAttribute(attr)
    else document.body.setAttribute(attr, previous)
  }
}
