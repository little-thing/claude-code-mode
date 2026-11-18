import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** 仅装入隔离验收 profile：通过真实宿主服务创建合成会话，不调用模型。 */
export const name = 'ccm-verifier-fixtures'
export const inject = ['webServer', 'sessionController', 'workspaceController', 'sessions']

export function apply(ctx) {
  let pending
  let generation = 0
  const seed = async (index = 0) => {
    const path = index === 0 ? process.env.CCM_FIXTURE_WORKSPACE : join(process.env.CCM_FIXTURE_WORKSPACE, `regression-${index}`)
    await mkdir(path, { recursive: true })
    const { workspace } = await ctx.workspaceController.create({ path })
    const sessions = []
    for (const label of ['CCM 验收主会话', 'CCM 验收对照会话', 'CCM 验收第三会话', 'CCM 验收第四会话']) {
      const title = `${label} ${index}`
      const { sessionId } = await ctx.sessionController.create({ workspaceId: workspace.workspaceId, sessionId: `session-${randomUUID()}` })
      const session = ctx.sessions.get(sessionId)
      if (!session) throw new Error('Created session is absent from the host store')
      session.append('turn/start', { turn: 1 })
      session.append('user/message', {
        id: randomUUID(), role: 'user', content: [{ type: 'text', text: `${title}：本消息由验收环境创建，不请求模型。` }],
        source: { kind: 'user' },
      }, { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await ctx.sessionController.rename({ sessionId, title })
      await ctx.sessions.flush(session)
      sessions.push({ id: sessionId, title })
    }
    return { workspaceId: workspace.workspaceId, sessions }
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/ccm-verifier/fixtures',
    async handler(request, response) {
      if (request.method !== 'POST') {
        response.writeHead(405, { 'content-type': 'application/json' })
        response.end('{"error":"POST required"}')
        return
      }
      try {
        if (new URL(request.url, 'http://localhost').searchParams.get('fresh') === '1') pending = seed(++generation)
        pending ??= seed()
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(await pending))
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: String(error) }))
      }
    },
  }), 'isolated verifier fixture endpoint')
}
