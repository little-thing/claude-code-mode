/** Web 收起态的图标 rail。
 *
 * DSH 的 AppFrame 只为「没有窗口级开关」的平台保留 56px 图标列：macOS 与
 * Windows 标题栏收起后列宽是 0，靠窗口左上角的开关重新打开侧栏；Web 没有
 * shell.leading，就用 rail 顶上那个面板图标。本插件的 chrome 在 Web 上同样
 * 提供开关和 hover 浮层，rail 因此成了多余的一列，这里把它压成 0，与桌面端
 * 一致。
 *
 * frame 的 grid-template-columns 是 AppFrame 在 React 里算出的内联样式，只能
 * 改内联值：只换第一段轨道（sidebar），其余两段原样保留；React 重写这段样式
 * （展开、收起、右栏宽度变化）后再换一次。抽屉模式的列宽本来就是 0，不动。
 */

/** 已经压平（0 宽）的 grid 值。 */
const REDUCED = /^0(?:\.0+)?px(?=\s|$)/
/** grid 的第一段轨道，例如 `56px`。 */
const FIRST_TRACK = /^\s*\d+(?:\.\d+)?px(?=\s|$)/

/** 桌面平台收起后本来就没有 rail（见 DSH AppFrame 的 collapsedWidth）。 */
function keepsNativeRail() {
  const { documentElement } = document
  return documentElement.dataset.platform === 'darwin'
    || documentElement.hasAttribute('data-windows-titlebar')
}

export function createCollapsedRail() {
  let frame = null
  let frameObserver = null
  let bodyObserver = null
  /** React 最后写进内联样式的 grid 值；卸载时还原成它。 */
  let reactGrid = ''
  /** 我们自己写进去的 grid 值；只有它还在 DOM 上时才恢复。 */
  let appliedGrid = ''
  const FLAT = 'data-ct-sidebar-rail-flat'

  const sync = () => {
    if (frame === null) return
    if (keepsNativeRail()
      || !frame.hasAttribute('data-sidebar-collapsed')
      || frame.hasAttribute('data-sidebar-drawer')) {
      // 展开、抽屉（列宽本来就是 0）或桌面平台：压平不再属于我们，撤掉标记。
      frame.removeAttribute(FLAT)
      appliedGrid = ''
      return
    }
    const current = frame.style.gridTemplateColumns
    if (current === '' || REDUCED.test(current)) return
    const next = current.replace(FIRST_TRACK, '0px')
    if (next === current) return
    reactGrid = current
    appliedGrid = next
    frame.style.gridTemplateColumns = next
    frame.setAttribute(FLAT, '')
  }

  const watch = element => {
    frame = element
    frameObserver = new MutationObserver(sync)
    frameObserver.observe(element, {
      attributes: true,
      attributeFilter: ['style', 'data-sidebar-collapsed', 'data-sidebar-drawer'],
    })
    sync()
  }

  const connect = () => {
    const element = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
    if (element !== null) {
      watch(element)
      return
    }
    // 插件先于 root 槽渲染时 frame 还不存在：等它出现再绑定一次。
    bodyObserver = new MutationObserver(() => {
      const found = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
      if (found === null) return
      bodyObserver?.disconnect()
      bodyObserver = null
      watch(found)
    })
    bodyObserver.observe(document.body, { childList: true, subtree: true })
  }

  connect()

  return {
    dispose() {
      bodyObserver?.disconnect()
      bodyObserver = null
      frameObserver?.disconnect()
      frameObserver = null
      // 插件卸载后 React 不会重写这段样式：只在 DOM 上仍是自己写的值时还原；
      // React 之后写过别的值（展开、抽屉）就说明压平已经失效，不能覆盖。
      if (frame !== null && appliedGrid !== '' && frame.style.gridTemplateColumns === appliedGrid) {
        frame.style.gridTemplateColumns = reactGrid
      }
      frame?.removeAttribute(FLAT)
      frame = null
      reactGrid = ''
      appliedGrid = ''
    },
  }
}
