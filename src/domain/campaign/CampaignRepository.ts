// ============================================================================
// SmartDialer — Campaign Repository
// ============================================================================

import { v4 as uuid } from 'uuid';
import type { Database } from '../../infrastructure/database.js';
import type { Campaign, CampaignMode, CampaignStatus, CampaignConfig } from './Campaign.js';

export class CampaignRepository {
  constructor(private readonly db: Database) {}

  create(name: string, mode: CampaignMode, config?: CampaignConfig): Campaign {
    const id = uuid();
    const now = new Date().toISOString();
    const configJson = JSON.stringify(config ?? {});

    this.db.prepare(`
      INSERT INTO campaigns (id, name, mode, status, config_json, created_at, updated_at)
      VALUES (?, ?, ?, 'created', ?, ?, ?)
    `).run(id, name, mode, configJson, now, now);

    return this.findById(id)!;
  }

  findById(id: string): Campaign | null {
    const row = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findAll(): Campaign[] {
    const rows = this.db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.mapRow(r));
  }

  updateStatus(id: string, status: CampaignStatus): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      'UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?'
    ).run(status, now, id);
    return result.changes === 1;
  }

  private mapRow(row: Record<string, unknown>): Campaign {
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      mode: row['mode'] as CampaignMode,
      status: row['status'] as CampaignStatus,
      configJson: row['config_json'] as string,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }
}
