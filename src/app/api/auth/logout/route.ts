import { apiJson } from "@/lib/api-response";
import { endSession } from "@/lib/auth";

export async function POST() {
  await endSession();
  return apiJson({ ok: true });
}
