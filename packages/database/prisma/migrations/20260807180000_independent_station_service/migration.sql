ALTER TYPE "ProductionTicketStatus" ADD VALUE 'SERVED';
ALTER TABLE "OrderStationTicket" ADD COLUMN "servedAt" TIMESTAMP(3);
