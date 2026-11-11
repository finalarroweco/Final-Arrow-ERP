import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { getLocale } from "@/lib/server-locale";
import { readStockTransfer } from "@/lib/stock-transfers";
import { TransferDetail } from "./detail";
import type { TransferRow } from "../types";
export default async function TransferDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser(); if (!user) redirect("/login");
  const { id } = await params; if (!z.string().uuid().safeParse(id).success) notFound();
  const query = z.object({ tenantId: z.string().uuid().optional(), expectedActorId: z.string().uuid().transform(v => v.toLowerCase()).optional() }).strict().safeParse(await searchParams);
  if (!query.success || (query.data.expectedActorId && query.data.expectedActorId !== user.id)) notFound();
  const transfer = await readStockTransfer(user.id, id); if (!transfer) notFound();
  return <TransferDetail actorId={user.id} initial={JSON.parse(JSON.stringify(transfer)) as TransferRow} locale={await getLocale()}/>;
}
