-- Phase U: SLA escalation tracking
--
-- `priorityRaisedAt` records when the escalation job bumped a ticket's priority
-- one level. Null until the first bump and never set again: escalation happens
-- once, and the column is what makes that enforceable by a job that otherwise
-- only sees the `escalated` boolean.

ALTER TABLE "Ticket" ADD COLUMN "priorityRaisedAt" TIMESTAMP;
