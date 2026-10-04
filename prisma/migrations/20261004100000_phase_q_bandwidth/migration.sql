-- Phase Q: bandwidth enforcement on MikroTik.
--
-- One column, defaulted off. Nothing else.
--
-- Off is the whole design: a queue with the wrong limits throttles a paying
-- customer to a speed they did not buy, and from the customer's side that is
-- indistinguishable from the network being slow. Until somebody opts a router in,
-- this application programs nothing on it beyond what it already did.

ALTER TABLE "Router" ADD COLUMN "autoQueues" BOOLEAN NOT NULL DEFAULT false;
