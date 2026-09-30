-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "fupThrottled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fupThrottledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "fupProfile" TEXT;
