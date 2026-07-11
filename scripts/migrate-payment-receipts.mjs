import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: rows, error: listError } = await supabase
  .from("payments")
  .select("id, screenshot_path")
  .not("screenshot_url", "is", null)
  .not("screenshot_path", "is", null)
  .is("receipt_bucket", null);
if (listError) throw listError;

let migrated = 0;
let failed = 0;
for (const row of rows ?? []) {
  const path = row.screenshot_path;
  try {
    const { data: file, error: downloadError } = await supabase.storage
      .from("chat-media")
      .download(path);
    if (downloadError) throw downloadError;

    const { error: uploadError } = await supabase.storage
      .from("payment-receipts")
      .upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
    if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
      throw uploadError;
    }

    const { error: updateError } = await supabase
      .from("payments")
      .update({
        screenshot_url: null,
        receipt_bucket: "payment-receipts",
      })
      .eq("id", row.id);
    if (updateError) throw updateError;

    const { error: removeError } = await supabase.storage.from("chat-media").remove([path]);
    if (removeError) throw removeError;
    migrated++;
  } catch (error) {
    failed++;
    console.error(
      `Failed to migrate payment ${row.id}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

console.log(`Payment receipt migration complete: ${migrated} migrated, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
