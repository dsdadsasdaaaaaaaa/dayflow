import { EmptyState } from '../EmptyState';

interface Props {
  icon: string;
  title: string;
  subtitle?: string;
}

/**
 * Design v3: a plain EmptyState. (Formerly added a glow halo; the name is
 * kept so call sites compile.)
 */
export function EmptyGlow(props: Props) {
  return <EmptyState {...props} />;
}
