/** 后台任务面板：右栏里的 jobs pane，只从会话 header 的「更多」进入。
 *
 * 数据与动作全部来自客户端的 jobs 服务（`ctx.jobs`）：
 *  - `state.rows[sessionId]`：该会话的后台任务花名册，靠 `watchRows` 保持订阅；
 *  - `state.observed[jobId]`：展开行的实时输出，靠 `observe` 按可见性开关；
 *  - `kill(sessionId, jobId)`：人在环停止（两段式确认）。
 *
 * 视觉参考 Claude 应用的 Background tasks pane：运行中在上、已完成在下，
 * 每行是状态点 + 标题 + 类型/进度 + 时长；运行中可停止，有输出可展开。
 * 输出块自绘（等宽、滚动、复制），不新增宿主 primitives 依赖。
 */

import * as React from 'react'

const h = React.createElement

/** 这个面板在右栏 tab 系统里的身份。 */
export const JOBS_TAB_ID = 'claude-code-mode:jobs'
/** tab kind：`sidebar://<kind>` 地址与布局记录的判别值。 */
export const JOBS_KIND = 'ct-jobs'

/** 两段式停止：第一次按下后等多久复位。 */
const KILL_ARM_MS = 3_000
/** 停止请求被拒后提示保留多久。 */
const KILL_FAILED_MS = 4_000
/** 距底部小于这个距离时，输出增长自动跟随到底。 */
const FOLLOW_SLOP_PX = 48

const EMPTY_ROWS = []

function isLive(job) {
  return job.status === 'running' || job.status === 'stopping'
}

/** 有输出（或仍在运行）才提供展开：和原生判定一致。 */
function isObservable(job) {
  return isLive(job) || job.output.total > 0
}

/** 行下方的补充文字：进度优先，其次终止原因。 */
function jobDetail(job) {
  return job.progress ?? job.detail
}

/** 运行中按开始时间升序，已完成按结束时间倒序。 */
function orderJobs(jobs) {
  return [...jobs].sort((left, right) => {
    const liveLeft = isLive(left)
    if (liveLeft !== isLive(right)) return liveLeft ? -1 : 1
    if (liveLeft) return left.startedAt - right.startedAt
    const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    return finished !== 0 ? finished : left.startedAt - right.startedAt
  })
}

/** 状态语义与 DSH 的 StateDot 对齐：进行中/琥珀/成功/错误/空闲。 */
function dotState(status) {
  switch (status) {
    case 'running': return 'ongoing'
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'killed': return 'warning'
    case 'failed': return 'error'
    default: return 'idle'
  }
}

function statusLabel(status, t) {
  return t(`status.${status}`)
}

/** 最多两个相邻单位，与原生 jobs 面板一致。 */
function formatDuration(elapsedMs, t) {
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
}

/** 展开输出：实时文本 + 复制，跟随到底。 */
function JobOutput({ job, view, t }) {
  const textRef = React.useRef(null)
  const first = React.useRef(true)
  const [copied, setCopied] = React.useState(false)
  const text = view === undefined ? '' : view.text

  React.useLayoutEffect(() => {
    const element = textRef.current
    if (element === null) return
    const atBottom = first.current
      || element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_SLOP_PX
    first.current = false
    if (atBottom) element.scrollTop = element.scrollHeight
  }, [text])

  React.useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => { setCopied(false) }, 1_500)
    return () => { clearTimeout(timer) }
  }, [copied])

  const copy = () => {
    const clipboard = globalThis.navigator?.clipboard
    if (clipboard === undefined) return
    void clipboard.writeText(text).then(() => { setCopied(true) }).catch(() => {})
  }

  return h('div', { className: 'ct-jobs-output', 'data-ct-jobs-output': String(job.id) },
    view !== undefined && view.gapBefore
      ? h('p', { className: 'ct-jobs-notice' }, t('output.gap'))
      : null,
    view !== undefined && view.error !== undefined
      ? h('p', { className: 'ct-jobs-notice', 'data-error': true }, t('output.error', { error: view.error }))
      : null,
    h('div', { className: 'ct-jobs-output-head' },
      h('span', { className: 'ct-jobs-output-kind' }, job.kind),
      h('button', {
        type: 'button',
        className: 'ct-jobs-copy',
        onClick: copy,
        'aria-label': t('output.copy'),
      }, copied ? t('output.copied') : t('output.copy'))),
    h('pre', {
      ref: textRef,
      className: 'ct-jobs-output-text',
      tabIndex: 0,
      'aria-label': t('output.label', { label: job.label }),
    }, text === '' ? t('output.empty') : text))
}

/** 单行任务：主体可展开，运行中带两段式停止。 */
function JobRow({ job, view, expanded, now, kill, onToggle, onKill, t }) {
  const live = isLive(job)
  const observable = isObservable(job)
  const elapsed = live ? now - job.startedAt : (job.finishedAt ?? job.startedAt) - job.startedAt
  const detail = jobDetail(job) ?? statusLabel(job.status, t)

  const body = h(React.Fragment, null,
    h('span', { className: 'ct-jobs-dot', 'data-state': dotState(job.status), 'aria-hidden': true }),
    h('span', { className: 'ct-jobs-text' },
      h('span', { className: 'ct-jobs-label' }, job.label),
      h('span', { className: 'ct-jobs-meta' },
        h('span', { className: 'ct-jobs-kind' }, job.kind),
        h('span', { className: 'ct-jobs-status' }, detail),
        h('span', { className: 'ct-jobs-duration' }, formatDuration(elapsed, t)))),
    observable
      ? h('svg', {
        className: 'ct-jobs-chevron',
        'data-open': expanded || undefined,
        width: 12,
        height: 12,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
      }, h('path', {
        d: 'M3.8 6.2 8 10.4l4.2-4.2',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
      : null)

  const killState = kill === undefined ? 'idle' : kill.state
  const showKillText = killState === 'armed' || killState === 'failed'
  const killLabel = killState === 'armed'
    ? t('kill.confirm')
    : killState === 'failed' ? t('kill.failed') : t('kill.stop', { label: job.label })

  return h('li', { className: 'ct-jobs-item', 'data-ct-job': String(job.id) },
    h('div', { className: 'ct-jobs-row', 'data-live': live || undefined },
      observable
        ? h('button', {
          type: 'button',
          className: 'ct-jobs-main',
          'aria-expanded': expanded,
          'aria-label': t(expanded ? 'row.collapse' : 'row.expand', { label: job.label }),
          onClick: onToggle,
        }, body)
        : h('span', { className: 'ct-jobs-main', 'data-static': true }, body),
      job.status === 'running'
        ? h('button', {
          type: 'button',
          className: 'ct-jobs-stop',
          'data-state': killState,
          disabled: killState === 'pending' || undefined,
          'aria-label': killLabel,
          onClick: onKill,
        },
          h('svg', { width: 9, height: 9, viewBox: '0 0 16 16', 'aria-hidden': true },
            h('rect', { x: 3.5, y: 3.5, width: 9, height: 9, rx: 1.6, fill: 'currentColor' })),
          showKillText ? h('span', { className: 'ct-jobs-stop-text' }, killLabel) : null)
        : null),
    expanded && observable
      ? h(JobOutput, { job, view, t })
      : null)
}

/** 分区标题：运行中是纯标题；已完成可折叠，并带「清空」。 */
function SectionHead({ label, count, collapsible, open, onToggle, onClear, clearLabel }) {
  const content = h(React.Fragment, null,
    collapsible
      ? h('svg', {
        className: 'ct-jobs-section-chevron',
        'data-open': open || undefined,
        width: 12,
        height: 12,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
      }, h('path', {
        d: 'M3.8 6.2 8 10.4l4.2-4.2',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
      : null,
    h('span', { className: 'ct-jobs-section-label' }, label),
    h('span', { className: 'ct-jobs-section-count' }, String(count)))

  return h('div', { className: 'ct-jobs-section-head' },
    collapsible
      ? h('button', {
        type: 'button',
        className: 'ct-jobs-section-toggle',
        'aria-expanded': open,
        onClick: onToggle,
      }, content)
      : h('span', { className: 'ct-jobs-section-static' }, content),
    collapsible && onClear !== undefined
      ? h('button', { type: 'button', className: 'ct-jobs-clear', onClick: onClear }, clearLabel)
      : null)
}

function EmptyState({ t }) {
  return h('div', { className: 'ct-jobs-empty' },
    h('span', { className: 'ct-jobs-empty-icon' },
      h('svg', { width: 22, height: 22, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M3 4.5h10M3 8h10M3 11.5h6', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))),
    h('p', { className: 'ct-jobs-empty-title' }, t('empty.title')),
    h('p', { className: 'ct-jobs-empty-hint' }, t('empty.hint')))
}

/**
 * @param {{ jobs: any, t: any }} deps 客户端 jobs 服务与文案
 * @returns 右栏 jobs tab 的 body 组件
 */
export function createJobsPanel({ jobs, t }) {
  function JobsPanel({ sessionId }) {
    // jobs.state 是稳定的 observable；快照不可变，直接交给 React 订阅。
    const snapshot = React.useSyncExternalStore(
      React.useCallback((listener) => jobs.state.subscribe(listener), []),
      React.useCallback(() => jobs.state.getSnapshot(), []),
    )
    const rows = snapshot.rows[sessionId] ?? EMPTY_ROWS
    const observed = snapshot.observed

    // 花名册：面板挂载期间保持该会话的 jobs 流。
    React.useEffect(() => jobs.watchRows(sessionId), [sessionId])

    const ordered = React.useMemo(() => orderJobs(rows), [rows])
    const liveRows = ordered.filter(isLive)
    const [expanded, setExpanded] = React.useState(undefined)
    const [settledOpen, setSettledOpen] = React.useState(undefined)
    const [cleared, setCleared] = React.useState(() => new Set())
    const [kill, setKill] = React.useState(undefined)
    const [now, setNow] = React.useState(() => Date.now())

    const settledRows = ordered.filter((job) => !isLive(job) && !cleared.has(String(job.id)))
    const settledExpanded = settledOpen ?? liveRows.length === 0

    // 切换会话时收起本地交互状态，不把上一个会话的展开/清空/确认带过来。
    const sessionRef = React.useRef(sessionId)
    React.useEffect(() => {
      if (sessionRef.current === sessionId) return
      sessionRef.current = sessionId
      setExpanded(undefined)
      setSettledOpen(undefined)
      setCleared(new Set())
      setKill(undefined)
    }, [sessionId])

    // 运行中的时长每秒走一格；没有运行中任务时不挂定时器。
    React.useEffect(() => {
      if (liveRows.length === 0) return undefined
      setNow(Date.now())
      const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
      return () => { clearInterval(timer) }
    }, [liveRows.length])

    // 输出观察跟着可见性走：展开开始、收起/关闭面板停止。
    const expandedJob = expanded === undefined
      ? undefined
      : ordered.find((job) => String(job.id) === expanded)
    const observedId = expandedJob === undefined || !isObservable(expandedJob)
      ? undefined
      : String(expandedJob.id)
    React.useEffect(() => {
      if (observedId === undefined) return undefined
      return jobs.observe(sessionId, observedId)
    }, [sessionId, observedId])

    // 展开的行离开花名册后自动收起，避免残留在空行下面。
    React.useEffect(() => {
      if (expanded === undefined) return
      if (!ordered.some((job) => String(job.id) === expanded)) setExpanded(undefined)
    }, [ordered, expanded])

    // 已确认/失败的停止按钮按时间复位；pending 等 RPC 或状态翻转。
    React.useEffect(() => {
      if (kill === undefined || kill.state === 'pending') return undefined
      const timer = setTimeout(() => { setKill(undefined) }, kill.state === 'armed' ? KILL_ARM_MS : KILL_FAILED_MS)
      return () => { clearTimeout(timer) }
    }, [kill])

    // 行不再可停止（已结束/消失）时，清掉残留的确认态。
    React.useEffect(() => {
      if (kill === undefined) return
      const row = ordered.find((job) => String(job.id) === kill.key)
      if (row === undefined || row.status !== 'running') setKill(undefined)
    }, [ordered, kill])

    const pressKill = (job) => {
      const key = String(job.id)
      if (kill === undefined || kill.key !== key || kill.state !== 'armed') {
        setKill({ key, state: 'armed' })
        return
      }
      setKill({ key, state: 'pending' })
      // 受理后保持 pending：行状态由 jobs 控制帧翻成 stopping，按钮随之消失。
      // jobs.kill 返回 `{ ok }`，只有 ok 才是受理成功。
      void jobs.kill(sessionId, key).then((result) => {
        if (result?.ok === true) return
        setKill((current) => (current?.key === key ? { key, state: 'failed' } : current))
      }).catch(() => {
        setKill((current) => (current?.key === key ? { key, state: 'failed' } : current))
      })
    }

    const clearSettled = () => {
      setCleared((current) => {
        const next = new Set(current)
        for (const job of settledRows) next.add(String(job.id))
        return next
      })
      if (expanded !== undefined && settledRows.some((job) => String(job.id) === expanded)) setExpanded(undefined)
    }

    const item = (job) => h(JobRow, {
      key: String(job.id),
      job,
      view: isObservable(job) ? observed[String(job.id)] : undefined,
      expanded: expanded === String(job.id),
      now,
      kill: kill !== undefined && kill.key === String(job.id) ? kill : undefined,
      onToggle: () => { setExpanded((current) => (current === String(job.id) ? undefined : String(job.id))) },
      onKill: () => { pressKill(job) },
      t,
    })

    const empty = liveRows.length === 0 && settledRows.length === 0

    return h('div', { className: 'ct-jobs', 'data-ct-jobs-panel': true },
      h('div', { className: 'ct-jobs-scroll' },
        empty
          ? h(EmptyState, { t })
          : h(React.Fragment, null,
            liveRows.length > 0
              ? h('section', { className: 'ct-jobs-section', 'data-ct-jobs-section': 'live' },
                h(SectionHead, { label: t('section.live'), count: liveRows.length }),
                h('ul', { className: 'ct-jobs-list' }, liveRows.map(item)))
              : null,
            settledRows.length > 0
              ? h('section', { className: 'ct-jobs-section', 'data-ct-jobs-section': 'settled' },
                h(SectionHead, {
                  label: t('section.settled'),
                  count: settledRows.length,
                  collapsible: true,
                  open: settledExpanded,
                  onToggle: () => { setSettledOpen(!settledExpanded) },
                  onClear: clearSettled,
                  clearLabel: t('clear'),
                }),
                settledExpanded ? h('ul', { className: 'ct-jobs-list' }, settledRows.map(item)) : null)
              : null)))
  }

  return JobsPanel
}
