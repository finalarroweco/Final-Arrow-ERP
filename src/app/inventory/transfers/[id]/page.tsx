import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { getLocale } from "@/lib/server-locale";
import { readStockTransfer } from "@/lib/stock-transfers";
import { TransferDetail } from "./detail";
import type { TransferRow } from "../types";
export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) redirect("/login");
  const { id } = await params; if (!z.string().uuid().safeParse(id).success) notFound();
  const transfer = await readStockTransfer(user.id, id); if (!transfer) notFound();
  return <TransferDetail actorId={user.id} initial={JSON.parse(JSON.stringify(transfer)) as TransferRow} locale={await getLocale()}/>;
}
