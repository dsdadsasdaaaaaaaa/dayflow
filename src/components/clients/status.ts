import type { ClientStatus } from '../../store/clientMeta';
import type { Theme } from '../../theme';

/**
 * Single source of truth for CRM status presentation (contract: lead = amber
 * #D97706, client = theme.accent, blocked = theme.textTertiary).
 */

/** Contract-fixed lead/warning amber — readable on light and dark. */
export const LEAD_AMBER = '#D97706';

export const STATUS_ORDER: ClientStatus[] = ['client', 'lead', 'blocked'];

export const STATUS_LABELS: Record<ClientStatus, string> = {
  lead: 'Lead',
  client: 'Client',
  blocked: 'Blocked',
};

export function statusColor(status: ClientStatus, theme: Theme): string {
  switch (status) {
    case 'lead':
      return LEAD_AMBER;
    case 'blocked':
      return theme.textTertiary;
    default:
      return theme.accent;
  }
}
