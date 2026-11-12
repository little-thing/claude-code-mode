// Claude 皮肤：只描述观感，不含任何布局/交互代码。
//
// 想加一套新皮肤，就在 src/skins/<id>/ 下放同样的 index.js + skin.css，
// 然后在 client/index.js 的 SKINS 里登记；body 属性由 core/skin.js 切。
import skinCss from './skin.css'

export default {
  id: 'claude',
  name: 'Claude',
  accent: '#d97757',
  css: skinCss,
}
