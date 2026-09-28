-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "roleId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "meta" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "zoneId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "downloadSpeed" INTEGER NOT NULL,
    "uploadSpeed" INTEGER NOT NULL,
    "monthlyPrice" DOUBLE PRECISION NOT NULL,
    "installationFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "billingCycle" TEXT NOT NULL DEFAULT 'Monthly',
    "fupLimit" DOUBLE PRECISION,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fatherName" TEXT,
    "motherName" TEXT,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "email" TEXT,
    "nid" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "address" TEXT,
    "areaId" TEXT,
    "customerType" TEXT NOT NULL DEFAULT 'Home',
    "photoUrl" TEXT,
    "username" TEXT NOT NULL,
    "password" TEXT,
    "connectionType" TEXT NOT NULL DEFAULT 'PPPoE',
    "packageId" TEXT,
    "ipType" TEXT NOT NULL DEFAULT 'Dynamic',
    "ipAddress" TEXT,
    "macAddress" TEXT,
    "routerId" TEXT,
    "oltId" TEXT,
    "onuId" TEXT,
    "ponPort" TEXT,
    "connectionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billingDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "monthlyBill" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "installationFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advancePayment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "previousDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "connectionStatus" TEXT NOT NULL DEFAULT 'Active',
    "billingStatus" TEXT NOT NULL DEFAULT 'Unpaid',
    "onlineStatus" TEXT NOT NULL DEFAULT 'Offline',
    "suspendReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "disconnectReason" TEXT,
    "disconnectedAt" TIMESTAMP(3),
    "lastOnlineAt" TIMESTAMP(3),
    "loginTime" TIMESTAMP(3),
    "downloadBytes" BIGINT NOT NULL DEFAULT 0,
    "uploadBytes" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPackageChange" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fromPkgId" TEXT,
    "toPkgId" TEXT,
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPackageChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "packageId" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "billingFrom" TIMESTAMP(3),
    "billingTo" TIMESTAMP(3),
    "amount" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Due',
    "note" TEXT,
    "createdById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "transactionId" TEXT,
    "accountId" TEXT NOT NULL,
    "collectedById" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Paid',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accountNumber" TEXT,
    "bankName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "paymentId" TEXT,
    "expenseId" TEXT,
    "transferId" TEXT,
    "userId" TEXT,
    "balance" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountTransfer" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT NOT NULL,
    "packageId" TEXT,
    "areaId" TEXT,
    "customerId" TEXT,
    "vendor" TEXT,
    "reference" TEXT,
    "description" TEXT,
    "attachmentUrl" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Router" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "ipAddress" TEXT NOT NULL,
    "location" TEXT,
    "areaId" TEXT,
    "apiPort" INTEGER NOT NULL DEFAULT 8728,
    "apiUser" TEXT,
    "apiSecretEnc" TEXT,
    "useSsl" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Unknown',
    "cpu" DOUBLE PRECISION,
    "ram" DOUBLE PRECISION,
    "uptimeSec" INTEGER,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Router_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Olt" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "model" TEXT,
    "ipAddress" TEXT,
    "location" TEXT,
    "areaId" TEXT,
    "ponPorts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Unknown',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Olt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Onu" (
    "id" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "name" TEXT,
    "vendor" TEXT,
    "oltId" TEXT,
    "areaId" TEXT,
    "ponIndex" TEXT,
    "rxPower" DOUBLE PRECISION,
    "txPower" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'Offline',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Onu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ipAddress" TEXT,
    "macAddress" TEXT,
    "routerId" TEXT,
    "loginTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logoutTime" TIMESTAMP(3),
    "downloadBytes" BIGINT NOT NULL DEFAULT 0,
    "uploadBytes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "OnlineSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "areaId" TEXT,
    "packageId" TEXT,
    "subject" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "technicianId" TEXT,
    "createdById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "areaId" TEXT,
    "joiningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "photoUrl" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Present',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Leave" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salary" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "basic" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonus" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Salary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "customerId" TEXT,
    "template" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Sent',
    "error" TEXT,
    "sentById" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsCredit" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'General',
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Manual',
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "ActivityLog_entity_entityId_idx" ON "ActivityLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_name_key" ON "Zone"("name");

-- CreateIndex
CREATE INDEX "Zone_status_idx" ON "Zone"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Area_code_key" ON "Area"("code");

-- CreateIndex
CREATE INDEX "Area_zoneId_idx" ON "Area"("zoneId");

-- CreateIndex
CREATE INDEX "Area_status_idx" ON "Area"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Area_name_zoneId_key" ON "Area"("name", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Package_name_key" ON "Package"("name");

-- CreateIndex
CREATE INDEX "Package_status_idx" ON "Package"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerCode_key" ON "Customer"("customerCode");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_username_key" ON "Customer"("username");

-- CreateIndex
CREATE INDEX "Customer_areaId_idx" ON "Customer"("areaId");

-- CreateIndex
CREATE INDEX "Customer_packageId_idx" ON "Customer"("packageId");

-- CreateIndex
CREATE INDEX "Customer_connectionStatus_idx" ON "Customer"("connectionStatus");

-- CreateIndex
CREATE INDEX "Customer_billingStatus_idx" ON "Customer"("billingStatus");

-- CreateIndex
CREATE INDEX "Customer_onlineStatus_idx" ON "Customer"("onlineStatus");

-- CreateIndex
CREATE INDEX "Customer_expiryDate_idx" ON "Customer"("expiryDate");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentId_key" ON "Payment"("paymentId");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_accountId_idx" ON "Payment"("accountId");

-- CreateIndex
CREATE INDEX "Payment_method_idx" ON "Payment"("method");

-- CreateIndex
CREATE INDEX "Payment_paymentDate_idx" ON "Payment"("paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_receiptNumber_key" ON "Receipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_name_key" ON "Account"("name");

-- CreateIndex
CREATE INDEX "Account_type_idx" ON "Account"("type");

-- CreateIndex
CREATE INDEX "Account_status_idx" ON "Account"("status");

-- CreateIndex
CREATE INDEX "AccountTransaction_accountId_idx" ON "AccountTransaction"("accountId");

-- CreateIndex
CREATE INDEX "AccountTransaction_date_idx" ON "AccountTransaction"("date");

-- CreateIndex
CREATE INDEX "AccountTransaction_type_idx" ON "AccountTransaction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "AccountTransfer_reference_key" ON "AccountTransfer"("reference");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_accountId_idx" ON "Expense"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Router_name_key" ON "Router"("name");

-- CreateIndex
CREATE INDEX "Router_status_idx" ON "Router"("status");

-- CreateIndex
CREATE INDEX "Router_areaId_idx" ON "Router"("areaId");

-- CreateIndex
CREATE UNIQUE INDEX "Olt_name_key" ON "Olt"("name");

-- CreateIndex
CREATE INDEX "Olt_status_idx" ON "Olt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Onu_serialNo_key" ON "Onu"("serialNo");

-- CreateIndex
CREATE INDEX "Onu_status_idx" ON "Onu"("status");

-- CreateIndex
CREATE INDEX "Onu_oltId_idx" ON "Onu"("oltId");

-- CreateIndex
CREATE INDEX "OnlineSession_customerId_idx" ON "OnlineSession"("customerId");

-- CreateIndex
CREATE INDEX "OnlineSession_loginTime_idx" ON "OnlineSession"("loginTime");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketNumber_key" ON "Ticket"("ticketNumber");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_priority_idx" ON "Ticket"("priority");

-- CreateIndex
CREATE INDEX "Ticket_technicianId_idx" ON "Ticket"("technicianId");

-- CreateIndex
CREATE INDEX "TicketComment_ticketId_idx" ON "TicketComment"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE INDEX "Leave_employeeId_idx" ON "Leave"("employeeId");

-- CreateIndex
CREATE INDEX "Leave_status_idx" ON "Leave"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Salary_employeeId_month_key" ON "Salary"("employeeId", "month");

-- CreateIndex
CREATE INDEX "Notification_channel_idx" ON "Notification"("channel");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Backup_createdAt_idx" ON "Backup"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "Olt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_onuId_fkey" FOREIGN KEY ("onuId") REFERENCES "Onu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPackageChange" ADD CONSTRAINT "CustomerPackageChange_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPackageChange" ADD CONSTRAINT "CustomerPackageChange_fromPkgId_fkey" FOREIGN KEY ("fromPkgId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPackageChange" ADD CONSTRAINT "CustomerPackageChange_toPkgId_fkey" FOREIGN KEY ("toPkgId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransaction" ADD CONSTRAINT "AccountTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransaction" ADD CONSTRAINT "AccountTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Router" ADD CONSTRAINT "Router_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Olt" ADD CONSTRAINT "Olt_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onu" ADD CONSTRAINT "Onu_oltId_fkey" FOREIGN KEY ("oltId") REFERENCES "Olt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onu" ADD CONSTRAINT "Onu_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineSession" ADD CONSTRAINT "OnlineSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Salary" ADD CONSTRAINT "Salary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

