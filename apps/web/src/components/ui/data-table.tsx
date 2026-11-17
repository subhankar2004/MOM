import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface Column<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right';
}

/** Simple semantic table for the admin/vendor consoles. Scrolls sideways inside its card on phones. */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty = 'Nothing here yet',
}: {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty?: string;
}) {
  return (
    // Focusable + named so keyboard users can scroll a wide table sideways on phones.
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-(--radius-card) border border-border bg-surface"
    >
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-2 text-left text-ink-muted">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn('px-4 py-2.5 font-semibold', c.align === 'right' && 'text-right')}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-ink-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-border">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn('px-4 py-3 whitespace-nowrap', c.align === 'right' && 'tabular text-right')}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
