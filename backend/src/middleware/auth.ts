import { Request, Response, NextFunction } from 'express';
import db from '../db/index.js';

export interface AuthedRequest extends Request {
  agent?: { id: number; gateway_id: string; agent_name: string; country: string };
}

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <gateway_id>' });
    return;
  }

  const gatewayId = authHeader.slice(7).trim();
  if (!gatewayId) {
    res.status(401).json({ error: 'Empty gateway_id' });
    return;
  }

  const agentName = (req.body?.agent_name as string) || 'Unknown';
  const country = (req.body?.country as string) || 'XX';

  // Upsert agent
  db.prepare(`
    INSERT INTO agents (gateway_id, agent_name, country)
    VALUES (?, ?, ?)
    ON CONFLICT(gateway_id) DO UPDATE SET
      agent_name = CASE WHEN excluded.agent_name != 'Unknown' THEN excluded.agent_name ELSE agents.agent_name END,
      country = CASE WHEN excluded.country != 'XX' THEN excluded.country ELSE agents.country END
  `).run(gatewayId, agentName, country);

  const agent = db.prepare('SELECT * FROM agents WHERE gateway_id = ?').get(gatewayId) as any;
  req.agent = agent;
  next();
}
