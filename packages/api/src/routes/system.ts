import {
  AnalysisStatus,
  Health,
  ScanStatus,
  Settings,
  SettingsPatch,
  YtmAccount,
  YtmStatus,
  type Core,
} from '@halocline/core'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import { requireScope, type ApiEnv } from '../auth'
import { authErrors, errorResponse } from '../problem'

const HealthReport = Health.extend({ scan: ScanStatus, ytm: YtmStatus })

export function registerSystem(app: OpenAPIHono<ApiEnv>, core: Core) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/health',
      tags: ['system'],
      summary: 'Streaming engine health and library scan progress',
      middleware: [requireScope('read')],
      responses: {
        200: { description: 'Health', content: { 'application/json': { schema: HealthReport } } },
        ...authErrors,
      },
    }),
    (c) =>
      c.json({ ...core.health.get(), scan: core.scanner.status(), ytm: core.ytm.status() }, 200),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/ytm/accounts',
      tags: ['system'],
      summary: 'The YouTube channels the signed-in account can use',
      description:
        "The Google account's own channel and any brand channels it manages. Empty when " +
        'signed out. `selected` marks the one in use.',
      middleware: [requireScope('read')],
      responses: {
        200: {
          description: 'Channels',
          content: { 'application/json': { schema: z.array(YtmAccount) } },
        },
        ...authErrors,
      },
    }),
    async (c) => c.json(await core.ytm.accounts(), 200),
  )

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/ytm/account',
      tags: ['system'],
      summary: 'Choose which channel YouTube Music is used as',
      description:
        'Search, both playback engines and Premium follow it. `null` goes back to the Google ' +
        "account's own channel.",
      middleware: [requireScope('admin')],
      request: {
        body: {
          content: {
            'application/json': { schema: z.object({ id: z.string().min(1).nullable() }) },
          },
          required: true,
        },
      },
      responses: {
        200: { description: 'Status', content: { 'application/json': { schema: YtmStatus } } },
        ...authErrors,
        404: errorResponse("Not one of the account's channels"),
      },
    }),
    async (c) => c.json(await core.ytm.selectAccount(c.req.valid('json').id), 200),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/analysis',
      tags: ['system'],
      summary: 'Audio analysis progress',
      description:
        'Local files and cached cloud tracks are analyzed in the background for autoplay ' +
        '(PLAN §7): tempo, key, loudness, energy and a sound embedding. Follow changes with ' +
        '`analysis.changed` events. Turn it off with `analysis.enabled` in settings.',
      middleware: [requireScope('read')],
      responses: {
        200: {
          description: 'Progress',
          content: { 'application/json': { schema: AnalysisStatus } },
        },
        ...authErrors,
      },
    }),
    (c) => c.json(core.analysis.status(), 200),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/settings',
      tags: ['system'],
      summary: 'Current settings',
      middleware: [requireScope('read')],
      responses: {
        200: { description: 'Settings', content: { 'application/json': { schema: Settings } } },
        ...authErrors,
      },
    }),
    (c) => c.json(core.settings.get(), 200),
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/settings',
      tags: ['system'],
      summary: 'Change settings',
      middleware: [requireScope('admin')],
      request: {
        body: { content: { 'application/json': { schema: SettingsPatch } }, required: true },
      },
      responses: {
        200: {
          description: 'Updated settings',
          content: { 'application/json': { schema: Settings } },
        },
        ...authErrors,
      },
    }),
    (c) => c.json(core.settings.patch(c.req.valid('json')), 200),
  )
}
