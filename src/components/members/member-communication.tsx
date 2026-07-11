"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

/**
 * Communication log — a static PREVIEW of the outbound message history
 * this member will accumulate. Real rows will be sourced from the
 * WhatsApp conversation once wired; until then this shows the shape.
 */
const PREVIEW_ROWS = [
  {
    id: "1",
    when: "Renewal reminder",
    channel: "WhatsApp",
    subject: "Your 3-Month plan expires soon — renew to keep training",
    status: "Delivered",
  },
  {
    id: "2",
    when: "Payment receipt",
    channel: "WhatsApp",
    subject: "Payment received — ₹3,999 for 3-Month plan",
    status: "Sent",
  },
] as const;

export function MemberCommunication() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Communication</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">Type</TableHead>
              <TableHead className="text-xs">Channel</TableHead>
              <TableHead className="text-xs">Subject</TableHead>
              <TableHead className="text-right text-xs">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PREVIEW_ROWS.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-muted-foreground">{r.when}</TableCell>
                <TableCell>
                  <Badge variant="neutral">{r.channel}</Badge>
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {r.subject}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="neutral">{r.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}
