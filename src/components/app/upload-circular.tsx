"use client";

import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { uploadCircularAction } from "@/lib/actions/circular-actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/uploads";

export function UploadCircular() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    const file = formData.get("file");

    // Checked here as well as on the server so an obvious mistake does not
    // cost a 10 MB upload first.
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a PDF to upload.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_MB} MB.`,
      );
      return;
    }

    startTransition(async () => {
      const result = await uploadCircularAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Uploaded — the agents are reading it now");
      router.push(`/circulars/${result.data.circularId}`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Upload a circular</CardTitle>
        <CardDescription>
          PDF only, up to {MAX_UPLOAD_MB} MB. The pipeline
          starts as soon as the file is stored.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form
          action={onSubmit}
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <Input
            ref={inputRef}
            type="file"
            name="file"
            accept="application/pdf,.pdf"
            required
            disabled={pending}
            onChange={(event) => {
              setError(null);
              setFileName(event.target.files?.[0]?.name ?? null);
            }}
            className="file:text-foreground cursor-pointer"
          />
          <Button type="submit" disabled={pending} className="shrink-0">
            {pending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            {pending ? "Uploading…" : "Upload and analyse"}
          </Button>
        </form>

        {fileName && !error && (
          <p className="text-muted-foreground mt-2 text-xs">
            Selected: {fileName}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
