import { FileText } from "lucide-react";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { UploadCircular } from "@/components/app/upload-circular";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { can, requireUser } from "@/lib/auth/guards";
import { listCirculars } from "@/lib/queries";

export const instant = false;

export const metadata = { title: "Circulars — RuleForge AI" };

export default async function CircularsPage() {
  const user = await requireUser("/circulars");
  const rows = await listCirculars();
  const mayUpload = can(user.role, "uploadCircular");

  return (
    <>
      <PageHeader
        title="Circulars"
        description="Regulatory circulars the agents have read, or are reading now."
      />

      {mayUpload && (
        <div className="mb-6">
          <UploadCircular />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No circulars yet"
          description={
            mayUpload
              ? "Upload a PDF above and the agents will start reading it immediately."
              : "A compliance officer needs to upload one before anything appears here."
          }
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden md:table-cell">Regulator</TableHead>
                  <TableHead className="hidden lg:table-cell">Number</TableHead>
                  <TableHead className="text-right">Obligations</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Uploaded by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link
                        href={`/circulars/${row.id}`}
                        className="hover:underline"
                      >
                        {row.title}
                      </Link>
                      <div className="text-muted-foreground mt-0.5 text-xs md:hidden">
                        {row.regulator.toUpperCase()}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-xs font-medium uppercase">
                        {row.regulator}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden font-mono text-xs lg:table-cell">
                      {row.circularNumber ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.obligationCount}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                      {row.uploadedByName ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
