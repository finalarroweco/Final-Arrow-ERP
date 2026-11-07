-- CreateEnum
CREATE TYPE "PosKitchenStatus" AS ENUM ('WAITING', 'PREPARING', 'READY', 'SERVED');

-- AlterTable
ALTER TABLE "PosOrder" ADD COLUMN     "kitchenStatus" "PosKitchenStatus" NOT NULL DEFAULT 'WAITING',
ADD COLUMN     "prepStartedAt" TIMESTAMP(3),
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "servedAt" TIMESTAMP(3);

ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_kitchen_check" CHECK (
 ("kitchenStatus" = 'WAITING' AND "prepStartedAt" IS NULL AND "readyAt" IS NULL AND "servedAt" IS NULL) OR
 ("kitchenStatus" = 'PREPARING' AND "prepStartedAt" IS NOT NULL AND "prepStartedAt" >= "createdAt" AND "readyAt" IS NULL AND "servedAt" IS NULL) OR
 ("kitchenStatus" = 'READY' AND "prepStartedAt" IS NOT NULL AND "prepStartedAt" >= "createdAt" AND "readyAt" IS NOT NULL AND "readyAt" >= "prepStartedAt" AND "servedAt" IS NULL) OR
 ("kitchenStatus" = 'SERVED' AND "prepStartedAt" IS NOT NULL AND "prepStartedAt" >= "createdAt" AND "readyAt" IS NOT NULL AND "readyAt" >= "prepStartedAt" AND "servedAt" IS NOT NULL AND "servedAt" >= "readyAt")
);
CREATE OR REPLACE FUNCTION protect_pos_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'POS orders cannot be deleted' USING ERRCODE = '23514'; END IF;
 IF NEW."kitchenStatus" <> OLD."kitchenStatus" THEN
  IF OLD."status" = 'CANCELLED' OR
   (to_jsonb(NEW) - ARRAY['kitchenStatus','prepStartedAt','readyAt','servedAt']) <> (to_jsonb(OLD) - ARRAY['kitchenStatus','prepStartedAt','readyAt','servedAt']) OR
   NOT ((OLD."kitchenStatus" = 'WAITING' AND NEW."kitchenStatus" = 'PREPARING') OR
        (OLD."kitchenStatus" = 'PREPARING' AND NEW."kitchenStatus" = 'READY' AND NEW."prepStartedAt" IS NOT DISTINCT FROM OLD."prepStartedAt") OR
        (OLD."kitchenStatus" = 'READY' AND NEW."kitchenStatus" = 'SERVED' AND NEW."prepStartedAt" IS NOT DISTINCT FROM OLD."prepStartedAt" AND NEW."readyAt" IS NOT DISTINCT FROM OLD."readyAt"))
  THEN RAISE EXCEPTION 'Invalid kitchen transition' USING ERRCODE = '23514'; END IF;
 ELSE
  IF OLD."status" <> 'OPEN' OR NEW."status" = 'OPEN' OR (to_jsonb(NEW) - ARRAY['status','paymentMethod','paymentReference','tendered','change','paidAt','cancelledAt','cancelReason']) <> (to_jsonb(OLD) - ARRAY['status','paymentMethod','paymentReference','tendered','change','paidAt','cancelledAt','cancelReason']) THEN
   RAISE EXCEPTION 'Only payment or cancellation of an open POS order is allowed' USING ERRCODE = '23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
