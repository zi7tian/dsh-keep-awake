import { createNativeManager } from './native/manager.js';

export const inject = ['agents', 'connection'];
export function apply(ctx) {
  const manager = createNativeManager();
  const running = new Set();
  const update = (agent, status) => {
    if (status === 'running') running.add(agent);
    else running.delete(agent);
    manager.update(running.size);
  };
  ctx.effect(() => () => manager.dispose());
  ctx.on('agent/status', ({ agent, status }) => update(agent, status));
  ctx.on('agent/created', ({ agent }) => { update(agent, agent.status); });
  ctx.on('agent/disposed', ({ agent }) => update(agent, 'idle'));
  for (const agent of ctx.agents.list()) if (agent.status === 'running') running.add(agent);
  manager.update(running.size);
  ctx.connection.fetch.register({
    path: '/api/keep-awake/native', methods: ['GET', 'POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
        if (typeof body?.enabled !== 'boolean') return new Response('enabled must be boolean', { status: 400 });
        manager.setEnabled(body.enabled);
      }
      return Response.json(manager.snapshot(), { headers: { 'Cache-Control': 'no-store' } });
    },
  });
}
