import type { CSSProperties } from 'react';

import { Skeleton } from '@/components/dashboard/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type TableSkeletonCellVariant =
  'text' | 'stacked' | 'identity' | 'badge' | 'checkbox' | 'actions';

export type TableSkeletonColumn = {
  label?: string;
  variant?: TableSkeletonCellVariant;
  width?: CSSProperties['width'];
  headClassName?: string;
  headStyle?: CSSProperties;
  cellClassName?: string;
  cellStyle?: CSSProperties;
};

const TEXT_WIDTHS = ['w-4/5', 'w-3/5', 'w-2/3', 'w-1/2'] as const;

function TextSkeleton({ seed }: { seed: number }) {
  return <Skeleton className={cn('h-4', TEXT_WIDTHS[seed % 4])} />;
}

function SkeletonCellContents({
  variant = 'text',
  seed,
}: {
  variant?: TableSkeletonCellVariant;
  seed: number;
}) {
  if (variant === 'checkbox') {
    return <Skeleton className="mx-auto size-4 rounded-sm" />;
  }

  if (variant === 'identity') {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="min-w-24 flex-1 space-y-1.5">
          <TextSkeleton seed={seed} />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }

  if (variant === 'stacked') {
    return (
      <div className="min-w-20 space-y-1.5">
        <TextSkeleton seed={seed} />
        <Skeleton className="h-3 w-1/2" />
      </div>
    );
  }

  if (variant === 'badge') {
    return <Skeleton className="h-5 w-16 rounded-full" />;
  }

  if (variant === 'actions') {
    return (
      <div className="flex justify-end gap-2">
        <Skeleton className="h-8 w-16 rounded-lg" />
        <Skeleton className="size-8 rounded-lg" />
      </div>
    );
  }

  return <TextSkeleton seed={seed} />;
}

export function TableSkeletonRows({
  columns,
  rows = 7,
  label = 'Loading table',
}: {
  columns: readonly TableSkeletonColumn[];
  rows?: number;
  label?: string;
}) {
  return (
    <>
      <TableRow className="sr-only">
        <TableCell colSpan={columns.length}>
          <span role="status">{label}</span>
        </TableCell>
      </TableRow>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <TableRow
          key={rowIndex}
          aria-hidden="true"
          className="hover:bg-transparent"
        >
          {columns.map((column, columnIndex) => (
            <TableCell
              key={columnIndex}
              className={column.cellClassName}
              style={column.cellStyle}
            >
              <SkeletonCellContents
                variant={column.variant}
                seed={rowIndex + columnIndex}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function TableSkeleton({
  columns,
  rows = 7,
  label = 'Loading table',
  className,
  containerClassName,
  headerClassName,
  style,
}: {
  columns: readonly TableSkeletonColumn[];
  rows?: number;
  label?: string;
  className?: string;
  containerClassName?: string;
  headerClassName?: string;
  style?: CSSProperties;
}) {
  return (
    <Table
      className={className}
      containerClassName={containerClassName}
      style={style}
      aria-busy="true"
    >
      {columns.some((column) => column.width) ? (
        <colgroup>
          {columns.map((column, index) => (
            <col key={index} style={{ width: column.width }} />
          ))}
        </colgroup>
      ) : null}
      <TableHeader className={headerClassName}>
        <TableRow className="hover:bg-transparent">
          {columns.map((column, index) => (
            <TableHead
              key={index}
              className={column.headClassName}
              style={column.headStyle}
            >
              {column.label ?? <Skeleton className="h-4 w-16" />}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableSkeletonRows columns={columns} rows={rows} label={label} />
      </TableBody>
    </Table>
  );
}
